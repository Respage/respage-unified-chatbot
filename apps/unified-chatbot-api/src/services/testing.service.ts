import {Logger} from "winston";
import {forwardRef, Inject, Injectable} from '@nestjs/common';
import {WINSTON_MODULE_PROVIDER} from "nest-winston";
import { OpenAiService } from "./open-ai.service";
import { ActiveCall } from "../models/active-call.model";
import { RedisService } from "./redis.service";
import { ResmateService } from "./resmate.service";
import { DateTime } from "luxon";

@Injectable()
export class TestingService {
    constructor(
        @Inject(forwardRef(() => ResmateService)) private resmateService: ResmateService,
        @Inject(forwardRef(() => RedisService)) private redisService: RedisService,
        @Inject(forwardRef(() => OpenAiService)) private openAIService: OpenAiService,
        @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger
    ) {}

    async onModuleInit() {}

    async generateConversation(campaignId: number, statements: string[], iterations: number = 1, phone: string = '5555555555') {
        const info = await this.redisService.getSystemPromptData(campaignId);
        
        const offerTours = !!info.tour_availability.in_person_tours_enabled;

        const results = [];
        for (let i = 0; i < iterations; i++) {
            const call = new ActiveCall(null, null, campaignId, info.tour_availability.timezone, offerTours);
                
            call.initTesting(
                {
                    property: info,
                    conversation: {phone}
                },
            );

            if (offerTours) {
                const tourTimeBuffer = info?.tour_availability?.closest_possible_tour_available_in_hours || 24;

                const nowDateTime = DateTime.local({zone: info.timezone});

                const earliestDateTime = nowDateTime.plus({hours: tourTimeBuffer});
                const {availableTimes, blockedTimes} = await this.resmateService.getTourTimes(campaignId, earliestDateTime.toFormat('yyyy-LL-dd'), 6);

                const update: { some_available_tour_times?: string[], blocked_tour_times?: string[] } = {};

                if (availableTimes?.length) {
                    update.some_available_tour_times = availableTimes.filter(x => DateTime.fromISO(x, {zone: info.timezone}) > earliestDateTime)
                }

                if (blockedTimes?.length) {
                    update.blocked_tour_times = blockedTimes;
                }

                if (update.some_available_tour_times || update.blocked_tour_times) {
                    call.updateSystemPrompt(update);
                    this.logger.info("VoiceService startCall getTourTimes available times added", {info: call.conversation.conversationInfo});
                }

            } else {
                delete info.tour_availability;
                delete info.schedule_tour_options;
                delete info.some_available_tour_times;
                delete info.blocked_tour_times;
            }

            const is_during_office_hours = await this.resmateService.isDuringOfficeHours(campaignId, info.timezone )
            call.updateSystemPrompt(null, {is_during_office_hours});

            let prospect = await this.resmateService.getProspect(campaignId, phone);
    
            if (prospect) {
                call.updateSystemPrompt(
                    null,
                    await this.resmateService.mapExistingProspectInfo(prospect)
                );
            } else {
                prospect = await this.resmateService.upsertProspect(campaignId, {
                    campaign_id: campaignId,
                    locale: 'en-US',
                    attribution_type: 'voice',
                    attribution_value: 'voice',
                    phone: phone,
                    timezone: info.timezone
                });
        
                call.updateSystemPrompt(null, {prospect: {_id: prospect._id, phone: prospect.phone, campaign_id: campaignId}});
            }

            for (const statement of statements) {
                call.updateCallHistory({role: 'user', content: statement});
                const {content, toolCalls} = await this.openAIService.getResponse(call);

                if (toolCalls?.length) {
                    for (const toolCall of toolCalls) {
                        await this.openAIService.callFunction(toolCall.function.name, call, toolCall.function.arguments);
                    }
                } else if (content) {
                    call.updateCallHistory({role: 'assistant', content});
                }
            }

            results.push(call.getCallHistory().map(x => ({speaker: x.role === 'assistant' ? 'Bot' : 'User', content: x.content})));
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        return results;
    }
}
