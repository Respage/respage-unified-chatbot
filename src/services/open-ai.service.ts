import {ChatHistoryLog, ConversationInfo} from "../models/conversation.model";

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
import {ElevenLabsService} from "./eleven-labs.service";
import {FUNCTIONS} from "../models/open-ai-functions.model";
import {VonageService} from "./vonage.service";

@Injectable()
export class OpenAiService {
    private client: OpenAI;

    constructor(
        @Inject(forwardRef(() => VoiceService)) private voiceService: VoiceService,
        @Inject(forwardRef(() => ResmateService)) private resmateService: ResmateService) {
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
                    console.log("Collect prompt text...");
                    chunks.push(chunk);
                } else {
                    if (chunks.length) {
                        console.log("Send AI prompt...");
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
                                const params = toolCall.function.arguments;
                                switch (toolCall.function.name) {
                                    case "schedule_tour": {
                                        console.log("SCHEDULE TOUR");
                                        if (!(
                                            params.time &&
                                            params.day &&
                                            params.month
                                        )) {
                                            await original_this.speakPrompt(stream, call, "[Apologize because something has gone wrong and ask the user to try again.]");
                                            break;
                                        }

                                        let prompt = '';
                                        let conversationInfoUpdate: ConversationInfo = {
                                            sms_consent: params.consent_to_sms
                                        };

                                        if (params.move_in_month) {
                                            conversationInfoUpdate.move_in_date = ActiveCall.compileTourDateTime(
                                                call.conversation.propertyInfo.tour_availability.timezone,
                                                null,
                                                params.move_in_day,
                                                params.move_in_month,
                                                params.move_in_year
                                            );
                                        }

                                        const tourDateTimeConfirmed = params.tour_confirmed;
                                        let tourDateTime = ActiveCall.compileTourDateTime(
                                            call.conversation.propertyInfo.tour_availability.timezone,
                                            params.time,
                                            params.day,
                                            params.month,
                                            params.year
                                        );

                                        const tourTimes = await original_this.resmateService.getTourTimes(
                                            call.conversation.campaign_id,
                                            tourDateTime.toFormat('yyyy-LL-dd'),
                                            1
                                        );
                                        console.log(tourTimes, tourDateTime.toISO());
                                        if (tourTimes.find(t => +DateTime.fromISO(t) === +tourDateTime)) {
                                            if (tourDateTimeConfirmed) {
                                                console.log("TOUR SCHEDULED: ", tourDateTime.toISO());

                                                conversationInfoUpdate.tour_date_time = tourDateTime;
                                                conversationInfoUpdate.tour_scheduled = true;
                                                conversationInfoUpdate.tour_date_time_confirmed = true;

                                                prompt = "[Tell the user the tour has been confirmed and continue the conversation.]";
                                            } else {
                                                conversationInfoUpdate.tour_date_time = tourDateTime;
                                                prompt = "[Have the user confirm the date and time.]";
                                            }
                                        } else {
                                            conversationInfoUpdate.tour_date_time = null;
                                            conversationInfoUpdate.tour_scheduled = false;
                                            conversationInfoUpdate.tour_date_time_confirmed = false;
                                            prompt = "[Apologize to the user because the tour time is unavailable.]"
                                        }

                                        call.updateSystemPrompt(null, conversationInfoUpdate);

                                        if (conversationInfoUpdate.tour_scheduled) {
                                            try {
                                                await original_this.resmateService.scheduleTour(call.conversation);
                                            } catch (e) {
                                                console.error(e);
                                                call.updateSystemPrompt(null, {tour_scheduled: false});
                                                prompt = "[Apologize to the user because something went wrong scheduling the tour.";
                                            }
                                        }

                                        await original_this.speakPrompt(stream, call, prompt);
                                    } break;
                                    case "talk_to_human": {
                                        if (call.canForwardCall()) {
                                            await original_this.speakPrompt(stream, call, "[Tell the user you will forward them to someone at the property now.]")

                                            call.forward()
                                            break;
                                        }

                                        await original_this.speakPrompt(stream, call, "[Tell the user you will notify someone at the office and then offer to help them without something else.]")
                                    } break;
                                }
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
            console.log("Closing Open AI completion stream");
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
            model: "gpt-4o",
            messages: additionalMessage ? [...call.getCallMessageWindow(), additionalMessage] : call.getCallMessageWindow(),
            stream: false,
        };

        const functions = call.getFunctions();

        if (functions) {
            params.functions = functions;
            params.function_call = function_call;
        }

        const completion: ChatCompletion = await this.client.chat.completions.create(params);

        const content = completion?.choices?.[0]?.message?.content;
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

    async getFunctionResults(call: ActiveCall, funcName: string) {
        const params: ChatCompletionCreateParamsNonStreaming = {
            model: "gpt-4o",
            messages: call.getCallHistory(),
            stream: false,
        };

        params.functions = [FUNCTIONS[funcName]];
        params.function_call = {name: funcName};

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

