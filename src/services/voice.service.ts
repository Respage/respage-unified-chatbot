import { readFileSync } from 'fs';
import { DateTime } from 'luxon';
import {forwardRef, Inject, Injectable} from '@nestjs/common';
import {WebSocket} from "ws";
import winston, {Logger} from "winston";
import {GoogleService} from "./google.service";
import {ElevenLabsService} from "./eleven-labs.service";
import {ActiveCall} from "../models/active-call.model";
import {OpenAiService} from "./open-ai.service";
import {RedisService} from "./redis.service";
import {ResmateService} from "./resmate.service";
import {VonageService} from "./vonage.service";
import {WINSTON_MODULE_PROVIDER} from "nest-winston";

@Injectable()
export class VoiceService {
    private activeCalls: {[id: string]: ActiveCall} = {};

    static readonly typingSounds: Buffer[] = [
        Buffer.from(readFileSync('./assets/typing_1_quiet.raw', {encoding: 'binary'}), 'binary'),
        Buffer.from(readFileSync('./assets/typing_2_quiet.raw', {encoding: 'binary'}), 'binary'),
        Buffer.from(readFileSync('./assets/typing_3_quiet.raw', {encoding: 'binary'}), 'binary'),
        Buffer.from(readFileSync('./assets/typing_4_quiet.raw', {encoding: 'binary'}), 'binary'),
    ];

    static readonly ambiantSound: Buffer = Buffer.from(readFileSync('./assets/ambiant_noise.raw', {encoding: 'binary'}), 'binary')

    constructor(
        @Inject(forwardRef(() => GoogleService)) private googleService: GoogleService,
        @Inject(forwardRef(() => ElevenLabsService)) private elevenLabsService: ElevenLabsService,
        @Inject(forwardRef(() => OpenAiService)) private openAIService: OpenAiService,
        @Inject(forwardRef(() => RedisService)) private redisService: RedisService,
        @Inject(forwardRef(() => ResmateService)) private resmateService: ResmateService,
        @Inject(forwardRef(() => VonageService)) private vonageService: VonageService,
        @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger
    ) {}

    async startCall(conversation_id: string, call_id: string, from_number: string, to_number: string, callSocket: WebSocket) {
        const voiceInbox = await this.resmateService.getVoiceInbox(to_number);
        if (!voiceInbox) {
            this.logger.error(
                'VoiceService startCall no voiceInbox',
            {
                    conversation_id,
                    call_id,
                    from_number,
                    to_number,
                    callSocket
                }
            );
            return;
        }

        const campaign_id = voiceInbox.campaign_id;

        const call = new ActiveCall(call_id, conversation_id, campaign_id);
        this.activeCalls[conversation_id] = call;

        const info = await this.redisService.getSystemPromptData(campaign_id);

        info.call_forwarding_number = voiceInbox.call_forwarding_number;

        const tourTimeBuffer = info?.tour_availability?.closest_possible_tour_available_in_hours || 24;

        const earliestDateTime = DateTime.now().plus({hours: tourTimeBuffer});
        this.resmateService.getTourTimes(campaign_id, earliestDateTime.toFormat('yyyy-LL-dd'), 6)
            .then((available_tour_times: string[]) => {
                if (available_tour_times?.length) {
                    available_tour_times = available_tour_times.filter(x => DateTime.fromISO(x) > earliestDateTime)
                    call.updateSystemPrompt({available_tour_times});
                }
            })
            .catch(e => this.logger.error({e}));

        this.resmateService.isDuringOfficeHours(campaign_id)
            .then((is_during_office_hours) => {
                call.updateSystemPrompt(null, {is_during_office_hours});
            })
            .catch(e => this.logger.error({e}));

        this.resmateService.getProspect(campaign_id, from_number)
            .then(async prospect => {
                if (prospect) {
                    call.updateSystemPrompt(null, {prospect, first_name: prospect.first_name, last_name: prospect.last_name});
                    return;
                }

                prospect = await this.resmateService.upsertProspect(campaign_id, {
                    campaign_id,
                    locale: 'en-US',
                    attribution_type: 'voice',
                    attribution_value: 'voice',
                    phone: from_number,
                    timezone: info.tour_availability.timezone
                });

                call.updateSystemPrompt(null, {prospect, first_name: prospect.first_name, last_name: prospect.last_name});
            })
            .catch(e => this.logger.error({e}));

        call.init(
            callSocket,
            this.googleService.getSpeechToTextStream(call),
            this.openAIService.getCompletionStream(call),
            this.elevenLabsService.getTextToSpeechStream(call),
            {
                property: info,
                conversation: {phone: from_number}
            },
            this.openAIService,
            this
        );

        call.onClose(async () => {
            try {
                const user_info: any = await this.openAIService.getFunctionResults(call, "collect_user_info");

                if (user_info.move_in_month) {
                    user_info.move_in_date = ActiveCall.compileTourDateTime(null, user_info.move_in_day, user_info.move_in_month, user_info.move_in_year);
                }

                const conversation = await this.resmateService.addConversation(call);

                if (call.conversation.conversationInfo.prospect.first_name) {
                    delete user_info.first_name;
                }

                if (call.conversation.conversationInfo.prospect.last_name) {
                    delete user_info.last_name;
                }

                await this.resmateService.upsertProspect(
                    call.conversation.campaign_id,
                    {
                        ...call.conversation.conversationInfo.prospect,
                        ...user_info,
                        conversation_id: conversation._id,
                        conversation_type: 'voice'
                    }
                );
            } catch (e) {
                this.logger.error({e});
            }
        });
    }

    async forwardCall(call: ActiveCall) {
        return this.vonageService.forwardCall(
            call.id,
            call.conversation.conversationInfo.phone,
            call.conversation.propertyInfo.call_forwarding_number
        );
    }

    getActiveCall(id: string) {
        return this.activeCalls[id];
    }
}
