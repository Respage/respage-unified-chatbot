import winston, {Logger} from "winston";
import {ChatHistoryLog, ConversationInfo, PropertyInfo} from "../models/conversation.model";

if (!process.env.NODE_ENV) {
    require('dotenv-extended').load({path: '.env'});
}

import {forwardRef, Inject, Injectable} from '@nestjs/common';
import {Duplex, Readable} from "stream";
import {VoiceService} from "./voice.service";
import OpenAI from "openai";
import {ActiveCall, DONE_BUFFER} from "../models/active-call.model";
import {ChatCompletionCreateParamsNonStreaming} from "openai/src/resources/chat/completions";
import {Chat} from "openai/resources";
import ChatCompletion = Chat.ChatCompletion;
import * as ffmpeg from 'fluent-ffmpeg';
import {ResmateService} from "./resmate.service";
import {DateTime} from "luxon";
import {WINSTON_MODULE_PROVIDER} from "nest-winston";
import {COLLECT_USER_INFO_FUNCTION} from "../models/open-ai-functions.model";

@Injectable()
export class OpenAiService {
    private client: OpenAI;

    private functions = {
        schedule_tour: async (stream, call: ActiveCall, params: {
            year: string,
            month: string,
            day: string,
            time: string,
            tour_confirmed: string,
            sms_consent: boolean
        }) => {
            if (call.getTourScheduled()) {
                await this.speakPrompt(
                    stream,
                    call,
                    "[If the user just scheduled a tour tell them their tour has been scheduled, otherwise tell the user they have already scheduled a tour. In either case tell them the date and time it has been scheduled for.]"
                );
                return;
            }

            let smsConsent = call.getSMSConsent();
            if (smsConsent !== true && smsConsent !== false && params.sms_consent === true) {
                try {
                    this.logger.info("OpenAiService completionStream LLM function schedule_tour sms_consent setting to true", {params});
                    await this.resmateService.upsertProspect(
                        call.conversation.campaign_id,
                        {sms_opt_in: true, sms_opt_in_source: 'voice', phone: call.conversation.conversationInfo.phone}
                    );
                    smsConsent = true;
                } catch (e) {
                    this.logger.error("OpenAiService completionStream LLM function schedule_tour sms_consent set", {e});
                    smsConsent = null;
                }
            }

            let tourConfirmed = params.tour_confirmed;
            let tourDate: DateTime = ActiveCall.compileTourDateTime(
                call.getTimezone(),
                params.day,
                params.month,
                params.year
            );

            if (!tourDate) {
                tourDate = call.getTourDate();
            }

            let tourTime = params.time;
            if (!tourTime) {
                tourTime = call.getTourTime();
            }

            let tourDateTime;
            if (tourDate && tourTime) {
                tourDateTime = ActiveCall.compileTourDateTime(
                    call.getTimezone(),
                    tourDate.day,
                    tourDate.monthLong,
                    tourDate.year,
                    tourTime
                );
            }

            if (!tourDateTime) {
                tourDateTime = call.getTourDateTime();
            }
            try {
                if (tourDateTime) {
                    if (tourConfirmed) {
                        call.updateSystemPrompt(
                            await this.getAvailableTimesUpdateForCall(call, tourDateTime),
                            {
                                tour_date: tourDate,
                                tour_time: tourTime,
                                tour_date_time: tourDateTime,
                                tour_date_time_confirmed: true,
                                sms_consent: smsConsent
                            });

                        if (call.checkTourTimeAvailable(tourDateTime)) {
                            if (!call.getTourDateTime()) {
                                call.updateSystemPrompt(null, { tour_date_time: tourDateTime });
                            }
                            await this.resmateService.scheduleTour(call.conversation);

                            call.updateSystemPrompt(null, {tour_scheduled: true});

                            await this.speakPrompt(stream, call, '[Tell the user their tour has been scheduled and ask if you can help with anything else.]');
                            return;
                        }

                        call.updateSystemPrompt(null,
                            {
                            tour_date: null,
                            tour_time: null,
                            tour_date_time: null,
                            tour_scheduled: null,
                            tour_date_time_confirmed: null
                        });

                        await this.speakPrompt(stream, call,"[Apologize and tell the user that the requested date and time are unavailable.]");
                        return;
                    } else {
                        call.updateSystemPrompt(
                            await this.getAvailableTimesUpdateForCall(call, tourDateTime),
                            {
                                tour_date: tourDate,
                                tour_time: tourTime,
                                tour_date_time: tourDateTime,
                                sms_consent: smsConsent
                            });

                        if (call.checkTourTimeAvailable(tourDateTime)) {
                            await this.speakPrompt(stream, call,"[Request confirmation of the user's tour date and time.]");
                            return;
                        }

                        await this.speakPrompt(stream, call,"[Apologize and tell the user that the requested date and time are unavailable.]");
                        return;
                    }
                } else {
                    await this.speakPrompt(stream, call,"[Ask the user the date and time they would like to schedule a tour.]");
                    return;
                }
            } catch (e) {
                this.logger.error("OpenAiService completionStream LLM function schedule_tour", {e, call});
                call.updateSystemPrompt(null, {
                    tour_date: null,
                    tour_time: null,
                    tour_date_time: null,
                    tour_scheduled: null,
                    tour_date_time_confirmed: null,
                });
                await this.speakPrompt(stream, call,"[Apologize to the user because something went wrong scheduling the tour. Ask them to try again.]");
                return;
            }
        },
        save_sms_consent: async (stream, call: ActiveCall, params: { sms_consent: boolean }) => {
            if (params.sms_consent) {
                await this.resmateService.upsertProspect(
                    call.conversation.campaign_id,
                    {sms_opt_in: true, sms_opt_in_source: 'voice', phone: call.conversation.conversationInfo.phone}
                );
            }

            call.updateSystemPrompt(
                null,
                {
                    sms_consent: params.sms_consent
                }
            );

            await this.speakPrompt(stream, call, '[Continue the conversation.]');
        },
        look_up_tour_times: async (stream, call: ActiveCall, params: {
            year: string,
            month: string,
            day: string,
            time: string,
        }) => {
            let tourDate: DateTime = ActiveCall.compileTourDateTime(
                call.getTimezone(),
                params.day,
                params.month,
                params.year,
            );

            let tourDateTime: DateTime;

            if (params.time) {
                tourDateTime = ActiveCall.compileTourDateTime(
                    call.getTimezone(),
                    params.day,
                    params.month,
                    params.year,
                    params.time
                );
            }

            call.updateSystemPrompt(
                await this.getAvailableTimesUpdateForCall(call, tourDateTime || tourDate),
                {
                    tour_date: tourDate,
                    tour_time: params.time,
                    tour_date_time: tourDateTime
                });

            if (tourDateTime && call.checkTourTimeAvailable(tourDateTime)) {
                await this.speakPrompt(stream, call, '[Tell the user that the time they want is available.]');
                return;
            }

            if (tourDate && call.checkTourDateAvailable(tourDate)) {
                await this.speakPrompt(stream, call, '[Tell the user that the day they want is available.]');
                return;
            }

            await this.speakPrompt(stream, call, '[Apologize and say that day or time is unavailable.]');
        },
        collect_tour_information: async (stream, call: ActiveCall, params: {
            year: string,
            month: string,
            day: string,
            time: string,
            consent_to_sms: boolean,
            tour_confirmed: boolean
        }) => {
            try {
                if (call.getTourScheduled()) {
                    await this.speakPrompt(stream, call, "[Tell the user they have already scheduled a tour and tell them the date and time.]");
                    return;
                }

                let smsConsent = call.getSMSConsent() || params.consent_to_sms;
                let tourConfirmed = call.getTourDateTimeConfirmed() || params.tour_confirmed;
                let tourDate: DateTime = ActiveCall.compileTourDateTime(
                    call.getTimezone(),
                    params.day,
                    params.month,
                    params.year
                );

                if (!tourDate) {
                    tourDate = call.getTourDate();
                }

                let tourTime = params.time;
                if (!tourTime) {
                    tourTime = call.getTourTime();
                }

                let tourDateTime;
                if (tourDate && tourTime) {
                    tourDateTime = ActiveCall.compileTourDateTime(
                        call.getTimezone(),
                        tourDate.day,
                        tourDate.monthLong,
                        tourDate.year,
                        tourTime
                    );
                }

                if (!tourDateTime) {
                    tourDateTime = call.getTourDateTime();
                }

                if (tourDateTime) {
                    if ((smsConsent === true || smsConsent === false) && tourConfirmed) {
                        try {
                            if (smsConsent) {
                                await this.resmateService.upsertProspect(
                                    call.conversation.campaign_id,
                                    {sms_opt_in: true, sms_opt_in_source: 'voice', phone: call.conversation.conversationInfo.phone}
                                );
                            }

                            call.updateSystemPrompt(
                                await this.getAvailableTimesUpdateForCall(call, tourDateTime),
                                {
                                    tour_date: tourDate,
                                    tour_time: tourTime,
                                    tour_date_time: tourDateTime,
                                    tour_date_time_confirmed: true,
                                    sms_consent: smsConsent
                                });

                            if (call.checkTourTimeAvailable(tourDateTime)) {
                                await this.resmateService.scheduleTour(call.conversation);

                                call.updateSystemPrompt(null, {tour_scheduled: true});

                                await this.speakPrompt(stream, call, '[Tell the user their tour has been scheduled and ask if you can help with anything else.]');
                                return;
                            }

                            await this.speakPrompt(stream, call,"[Apologize and tell the user that the requested date and time are unavailable.]");
                            return;
                        } catch (e) {
                            this.logger.error("OpenAiService completionStream LLM function confirm_tour_date_time", {e, call});
                            call.updateSystemPrompt(null, {
                                tour_date: null,
                                tour_time: null,
                                tour_date_time: null,
                                tour_scheduled: null,
                                tour_date_time_confirmed: null,
                                sms_consent: null
                            });
                            await this.speakPrompt(stream, call,"[Apologize to the user because something went wrong scheduling the tour.");
                            return;
                        }
                    } else if (smsConsent !== true && smsConsent !== false) {
                        call.updateSystemPrompt(null, {
                            tour_date: tourDate,
                            tour_time: tourTime,
                            tour_date_time: tourDateTime,
                            tour_date_time_confirmed: true
                        });

                        await this.speakPrompt(stream, call,"[Request consent to send the user SMS messages.]");
                        return;
                    } else {
                        call.updateSystemPrompt(
                            await this.getAvailableTimesUpdateForCall(call, tourDateTime),
                            {
                                tour_date: tourDate,
                                tour_time: tourTime,
                                tour_date_time: tourDateTime,
                                sms_consent: smsConsent
                            });

                        if (call.checkTourTimeAvailable(tourDateTime)) {
                            await this.speakPrompt(stream, call,"[Request confirmation of the user's tour date and time.]");
                            return;
                        }

                        await this.speakPrompt(stream, call,"[Apologize and tell the user that the requested date and time are unavailable.]");
                        return;
                    }
                } else {
                    if (tourDate) {
                        call.updateSystemPrompt(
                            await this.getAvailableTimesUpdateForCall(call, tourDate),
                            {
                                tour_date: tourDate,
                                sms_consent: smsConsent,
                                tour_date_time_confirmed: false
                            });

                        if (call.checkTourDateAvailable(tourDate)) {
                            await this.speakPrompt(stream, call,"[Ask the user what time they would like to schedule a tour for.]");
                            return;
                        }

                        await this.speakPrompt(stream, call,"[Apologize and tell the user that the requested time is unavailable.]");

                        return;
                    }

                    if (tourTime) {
                        call.updateSystemPrompt(null, {
                            tour_time: tourTime,
                            sms_consent: smsConsent,
                            tour_date_time_confirmed: false
                        });

                        await this.speakPrompt(stream, call,"[Ask the user what day they would like to schedule a tour for.]");
                        return;
                    }

                    call.updateSystemPrompt(null, {
                        sms_consent: smsConsent,
                    });

                    await this.speakPrompt(stream, call,"[Ask the user when they would like to schedule a tour for.]");
                    return;
                }
            } catch (e) {
                this.logger.error({e});
                await this.speakPrompt(stream, call,"[Apologize and tell the user that something went wrong. Ask them to try again or ask about something else.]");
            }
        },
        talk_to_human: async (stream, call: ActiveCall, params: {reason: string}) => {
            try {
                this.logger.info("OpenAiService completionStream LLM function talk_to_human", {call, params});
                let prompt;
                if (call.canForwardCall()) {
                    prompt = "[Tell the user you will forward them to someone at the property now.]";
                    call.forward()
                    try {
                        await this.resmateService.escalateToHumanContact(call, params.reason)
                    } catch(e) {
                        this.logger.error({e});
                    }
                } else {
                    prompt = "[Tell the user you will notify someone at the office and then offer to help them with something else.]";

                    try {
                        await this.resmateService.escalateToHumanContact(call, params.reason)
                    } catch(e) {
                        this.logger.error({e});
                        prompt = "[Apologize and tell the user you were unable to contact the office. Ask them if there is any other way you can help.]"
                    }
                }

                await this.speakPrompt(stream, call, prompt);
            } catch (e) {
                this.logger.error({e});
                await this.speakPrompt(stream, call,"[Apologize and tell the user that something went wrong. Ask them to try again or ask about something else.]");
            }
        }
    };

    async getAvailableTimesUpdateForCall(call: ActiveCall, tourDate: DateTime): Promise<PropertyInfo> {
        const {availableTimes, blockedTimes} = await this.resmateService.getTourTimes(
            call.conversation.campaign_id,
            tourDate.toFormat('yyyy-LL-dd'),
            1
        );

        if (!availableTimes?.length) {
            return;
        }

        return {
            some_available_tour_times: call.updatedAvailableTourTimes(availableTimes, tourDate.toISODate()),
            blocked_tour_times: call.updatedBlockedTourTimes(blockedTimes?.length ? blockedTimes : [], tourDate.toISODate())
        };
    }

    constructor(
        @Inject(forwardRef(() => VoiceService)) private voiceService: VoiceService,
        @Inject(forwardRef(() => ResmateService)) private resmateService: ResmateService,
        @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger) {
        this.client = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
            organization: process.env.OPENAI_ORGANIZATION
        });
        ffmpeg.setFfmpegPath("./bin/ffmpeg");
    }

    async getTextEmbedding(text, model = "text-embedding-3-small") {
        text = text.replace(/\n/g, " ");
        const response = await this.client.embeddings.create({input: text, model});

        return response.data[0].embedding;
    }

    getTextToSpeechStream(): Duplex {
        const original_this = this;
        const writeStream = require('fs').createWriteStream('temp.raw', {encoding: "binary"});
        const stream = new Duplex({
            read() {},
            async write(chunk, encoding, callback) {
                callback();

                let response;
                let str = chunk.toString();
                for (let i = 0; i < str.length; i+= 4096) {
                    response  = await original_this.client.audio.speech.create({
                        model: "tts-1",
                        voice: "alloy",
                        input: str.substring(i, i + 4096),
                        response_format: 'pcm',
                        speed: 1
                    });

                    for await (let chunk of response.body as any) {
                        writeStream.write(chunk);
                    }

                    ffmpeg(response.body as unknown as Readable)
                        .format("s16le")
                        .inputFormat("s16le")
                        .audioFrequency(16000)
                        .stream(stream);
                }

                // const audioOverflowBuffer = Buffer.alloc(640, 0, 'binary');
                //
                // let bufferIndex = 0;
                // let chunkIndex = 0;
                // let overflowIndex = 0;
                // const writeStream = require('fs').createWriteStream('temp.raw', {encoding: "binary"});
                // for await (const chunk of response.body as unknown as AsyncIterable<any>) {
                //     const chunkBuffer = Buffer.from(chunk);
                //
                //     // const downSampled = Buffer.alloc(Math.floor(chunkBuffer.length * 0.666666667));
                //     // for (let i = 0, j = 0; i < chunkBuffer.length - 2 && j < downSampled.length - 1; i += 3, j += 2) {
                //     //     downSampled[j] = chunkBuffer[i];
                //     //     downSampled[j + 1] = chunkBuffer[i + 2];
                //     // }
                //
                //     chunkIndex = 0;
                //     overflowIndex = chunkBuffer.length;
                //
                //     if (bufferIndex) {
                //         chunkIndex = 640 - bufferIndex;
                //         if (chunkIndex < chunkBuffer.length) {
                //             chunkBuffer.copy(audioOverflowBuffer, bufferIndex, 0, chunkIndex);
                //             writeStream.write(Buffer.from(audioOverflowBuffer));
                //             stream.push(Buffer.from(audioOverflowBuffer));
                //             bufferIndex = 0;
                //         } else {
                //             chunkBuffer.copy(audioOverflowBuffer, bufferIndex);
                //             bufferIndex += chunkBuffer.length
                //             continue;
                //         }
                //     }
                //
                //     const overflow = chunkBuffer.length < 640 ? chunkBuffer.length : (chunkBuffer.length - chunkIndex) % 640;
                //     if (overflow) {
                //         bufferIndex = overflow;
                //         overflowIndex = chunkBuffer.length - overflow;
                //         chunkBuffer.copy(audioOverflowBuffer, 0, overflowIndex);
                //
                //         if (overflow === chunkBuffer.length) {
                //             continue;
                //         }
                //     }
                //
                //     const window = chunkBuffer.subarray(chunkIndex, overflowIndex);
                //     writeStream.write(window);
                //     stream.push(window);
                // }
            }
        });

        return stream;
    }

    getCompletionStream(call: ActiveCall): Duplex {
        const original_this = this;
        let chunks = [];
        const stream = new Duplex({
            read() {},
            async write(chunk, encoding, callback) {
                if (chunk.compare(DONE_BUFFER)) {
                    chunks.push(chunk);
                } else {
                    if (chunks.length) {
                        const completeBuffer = Buffer.concat(chunks);

                        let responsePromise;
                        if (!call.internalMessageIncoming) {
                            call.updateCallHistory({role: "user", content: completeBuffer.toString()});
                            responsePromise = original_this.getResponse(call);
                        } else {
                            call.internalMessageIncoming = false;
                            responsePromise = original_this.getResponse(call, {role: "user", content: completeBuffer.toString()});
                        }

                        const { content, toolCalls } = await responsePromise;

                        if (toolCalls.length) {

                            for (const toolCall of toolCalls) {
                                original_this.logger.info("Calling function", {toolCall});
                                await original_this.functions[toolCall.function.name](stream, call, toolCall.function.arguments);
                            }
                        } else if (content) {
                            stream.push(content);
                            stream.push(DONE_BUFFER);
                            call.updateCallHistory({role: "assistant", content});
                        }
                        chunks = [];
                    }
                }

                callback();
            }
        });

        call.onClose(() => {
            this.logger.info("Closing Open AI completion stream");
            stream.end();
        });

        return stream;
    }

    async speakPrompt(stream, call, message: string) {
        const {content} = await this.getResponse(call, {role: "user", content: message},  "none");

        call.updateCallHistory({role: "assistant", content});

        stream.push(content);
        stream.push(DONE_BUFFER);
    }

    async getResponse(call: ActiveCall, additionalMessage?: ChatHistoryLog, function_call: 'none' | 'auto' = 'auto') {
        const params: ChatCompletionCreateParamsNonStreaming = {
            model: process.env.OPEN_AI_GPT_MODEL,
            messages: additionalMessage ? [...call.getCallMessageWindow(), additionalMessage] : call.getCallMessageWindow(),
            temperature: +process.env.OPEN_AI_TEMP,
            stream: false,
        };

        const functions = call.getFunctions();

        if (functions) {
            params.functions = functions;
            params.function_call = function_call;
        }

        const completion: ChatCompletion = await this.client.chat.completions.create(params);

        const content = completion?.choices?.[0]?.message?.content.replace(/[*]/g, '');
        const toolCalls = completion?.choices?.[0]?.message?.tool_calls ||
                          (completion?.choices?.[0]?.message?.function_call && [{function: completion?.choices?.[0]?.message?.function_call}]) || [];

        return {
            content,
            toolCalls: toolCalls.map(x => {
                if (x?.function?.arguments) {
                    x.function.arguments = JSON.parse(x.function.arguments)
                } else {
                    x.function.arguments = {} as any;
                }

                return x;
            })
        };
    }

    async collectConversationInfo(call: ActiveCall) {
        const params: ChatCompletionCreateParamsNonStreaming = {
            model: process.env.OPEN_AI_GPT_MODEL,
            messages: [
                {
                    role: 'system',
                    content: `You analyze chat conversations with prospective renters at multifamily properties and collect relevant data. Today's date is ${(new Date()).toString().split(/\d\d:\d\d:\d\d/)[0].trim()}.`
                },
                ...call.getCallHistory()
            ],
            stream: false,
        };

        params.functions = [COLLECT_USER_INFO_FUNCTION];
        params.function_call = {name: "collect_user_info"};

        const completion: ChatCompletion = await this.client.chat.completions.create(params);
        const toolCalls = completion?.choices?.[0]?.message?.tool_calls ||
                            (completion?.choices?.[0]?.message?.function_call && [{function: completion?.choices?.[0]?.message?.function_call}]) || [];

        toolCalls.map(x => {
            if (x.function.arguments) {
                x.function.arguments = JSON.parse(x.function.arguments)
            }

            return x;
        });

        return toolCalls?.[0]?.function?.arguments;
    }
}

