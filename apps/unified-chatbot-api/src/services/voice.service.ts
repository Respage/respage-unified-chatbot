import {readFileSync} from 'fs';
import {DateTime} from 'luxon';
import {forwardRef, Inject, Injectable} from '@nestjs/common';
import {WebSocket} from "ws";
import {Logger} from "winston";
import {GoogleService} from "./google.service";
import {ElevenLabsService} from "./eleven-labs.service";
import {ActiveCall} from "../models/active-call.model";
import {OpenAiService} from "./open-ai.service";
import {RedisService} from "./redis.service";
import {ResmateService} from "./resmate.service";
import {VonageService} from "./vonage.service";
import {WINSTON_MODULE_PROVIDER} from "nest-winston";
import {LaunchDarklyService} from "./launchdarkly.service";
import {FeatureFlag} from "../models/feature_flag_enum";

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
        @Inject(forwardRef(() => LaunchDarklyService)) private launchDarklyService: LaunchDarklyService,
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
        const info = await this.redisService.getSystemPromptData(campaign_id);
        this.logger.info("SYSTEM PROMPT INFO", {info});
        const offerTours = !!info.tour_availability.in_person_tours_enabled;

        const call = new ActiveCall(call_id, conversation_id, campaign_id, info.tour_availability.timezone, offerTours);
        this.logger.info("SYSTEM PROMPT", {prompt: call.conversation.getSystemPrompt()});
        this.activeCalls[conversation_id] = call;

        info.call_forwarding_number = voiceInbox.call_forwarding_number;

        if (offerTours) {
            const tourTimeBuffer = info?.tour_availability?.closest_possible_tour_available_in_hours || 24;

            const nowDateTime = DateTime.local({zone: info.tour_availability.timezone});

            const earliestDateTime = nowDateTime.plus({hours: tourTimeBuffer});
            this.resmateService.getTourTimes(campaign_id, earliestDateTime.toFormat('yyyy-LL-dd'), 6)
                .then(({availableTimes, blockedTimes}) => {
                    const update: { some_available_tour_times?: string[], blocked_tour_times?: string[] } = {};

                    if (availableTimes?.length) {
                        update.some_available_tour_times = availableTimes.filter(x => DateTime.fromISO(x, {zone: info.tour_availability.timezone}) > earliestDateTime)
                    }

                    if (blockedTimes?.length) {
                        update.blocked_tour_times = blockedTimes;
                    }

                    if (update.some_available_tour_times || update.blocked_tour_times) {
                        call.updateSystemPrompt(update);
                        this.logger.info("VoiceService startCall getTourTimes available times added", {info: call.conversation.conversationInfo});
                    }
                })
                .catch(e => this.logger.error({e}));
        }

        this.resmateService.isDuringOfficeHours(campaign_id, info.tour_availability.timezone )
            .then((is_during_office_hours) => {
                call.updateSystemPrompt(null, {is_during_office_hours});
                this.logger.info("VoiceService startCall getTourTimes isDuringOfficeHours", {info: call.conversation.conversationInfo});
            })
            .catch(e => this.logger.error({e}));

        this.resmateService.getProspect(campaign_id, from_number)
            .then(async prospect => {
                if (prospect) {
                    call.updateSystemPrompt(
                        null,
                        await this.resmateService.mapExistingProspectInfo(prospect)
                    );

                    this.logger.info("VoiceService startCall getTourTimes getProspect existing prospect", {info: call.conversation.conversationInfo});
                    return;
                }

                const doDelay = await this.launchDarklyService.isFeatureFlagEnabled(FeatureFlag.DelayProspectGeneration, campaign_id);

                if (doDelay) {
                    call.delayProspectSaving = true;
                    call.updateSystemPrompt(null, {prospect: {phone: from_number, campaign_id, timezone: info.tour_availability.timezone}});
                } else {
                    prospect = await this.resmateService.upsertProspect(campaign_id, {
                        campaign_id,
                        locale: 'en-US',
                        attribution_type: 'voice',
                        attribution_value: 'voice',
                        phone: from_number,
                        timezone: info.tour_availability.timezone
                    });

                    const {_id, phone} = prospect;

                    call.updateSystemPrompt(null, {prospect: {_id, phone, campaign_id}});
                    this.logger.info("VoiceService startCall getTourTimes getProspect new prospect", {info: call.conversation.conversationInfo});
                }
            })
            .catch(e => this.logger.error("VoiceService startCall", {info: call.conversation.conversationInfo, e}));

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
            this,
            info.voice_call_start_delay || 0
        );

        call.onClose(async () => {
            try {
                const user_info: any = await this.openAIService.collectConversationInfo(call);
                this.logger.info("call onClose", {info: call.conversation.conversationInfo, user_info});
                if (user_info.move_in_month) {
                    user_info.move_in_date = ActiveCall.compileTourDateTime(call.conversation.timezone, user_info.move_in_day, user_info.move_in_month, user_info.move_in_year);
                }

                let interestStrings = [];
                if (Array.isArray(user_info.interests) && user_info.interests.length) {
                    interestStrings = user_info.interests.map(i => i.trim()).filter(i => !!i);
                } else if (typeof user_info.interests === 'string') {
                    interestStrings = user_info.interests.split(',').map(i => i.trim()).filter(i => !!i);
                }

                const interests = interestStrings.map(i => ({
                    display_name: i.split(' ').map(s => s[0].toUpperCase() + s.slice(1)).join(' '),
                    type: 'LLM',
                    value: i
                }));

                const upsert = {
                    ...call.conversation.conversationInfo.prospect,
                    ...user_info,
                    interests,
                    locale: 'en-US',
                    attribution_type: 'voice',
                    attribution_value: 'voice',
                    await_external_integration_ids: true
                };

                if (user_info.sms_consent && !call.getSMSConsent()) {
                    upsert.sms_opt_in = true;
                    upsert.sms_opt_in_source = 'voice';
                    upsert.phone = call.conversation.conversationInfo.phone;
                }

                const prospect = await this.resmateService.upsertProspect(call.conversation.campaign_id, upsert);
                const conversation = await this.resmateService.addConversation(prospect._id, call);

                await this.resmateService.upsertProspect(
                    call.conversation.campaign_id,
                    {
                        _id: prospect._id,
                        phone: prospect.phone,
                        conversation_id: conversation._id,
                        conversation_type: 'voice',
                    }
                );

                try {
                    if (user_info.tour_date_time && user_info.tour_confirmed && user_info.tour_scheduled) {
                        const collectedDate = DateTime.fromISO(user_info.tour_date_time).toUTC().setZone(call.getTimezone(), {keepLocalTime: true});
                        this.logger.info("call onClose detected tour date / time", {info: call.conversation.conversationInfo, user_info, collectedDate: collectedDate.toISO()});
                        if (!call.getTourScheduled()) {
                            try {
                                const {availableTimes} = await this.resmateService.getTourTimes(
                                    call.conversation.campaign_id,
                                    collectedDate.toFormat('yyyy-LL-dd'),
                                    1
                                );

                                if (availableTimes?.length) {
                                    if (availableTimes.find(t => +DateTime.fromISO(t, {zone: call.getTimezone()}) === +collectedDate)) {
                                        call.updateSystemPrompt(null, {tour_date_time: collectedDate});
                                        await this.resmateService.scheduleTour(call);
                                    }
                                } else {
                                    await this.resmateService.escalateToHumanContact(call, "The user was given an unavailable tour date and time.");
                                }
                            } catch(e) {
                                await this.resmateService.escalateToHumanContact(call, "Something went wrong scheduling this user's tour.");
                                throw e;
                            }

                        } else if (!collectedDate.equals(call.getTourDateTime())) {
                            this.logger.error(
                                "call onClose double check tour collectedDate is not equal to saved tour_date_time",
                                {
                                    collectedDate: collectedDate.toISO(), tour_date_time: call.getTourDateTime()
                                }
                            );
                            await this.resmateService.escalateToHumanContact(call, "The user may have been scheduled for the wrong time.");
                        }
                    }
                } catch (e) {
                    this.logger.error("call onClose double check tour", {e});
                }
            } catch (e) {
                this.logger.error("call onClose", {e});
            }
        });
        delete this.activeCalls[call.conversation_id];
        this.logger.info("VoiceService startCall call started", {info: call.conversation.conversationInfo});
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

    log(level: 'info' | 'error', message: string, data: any = null) {
        this.logger[level](message, data);
    }
}
