import {Logger} from "winston";
import axios from "axios";
import {forwardRef, Inject, Injectable} from "@nestjs/common";
import {DateTime} from "luxon";
import {ChatHistoryLog, ConversationInfo} from "../models/conversation.model";
import {ActiveCall} from "../models/active-call.model";
import {WINSTON_MODULE_PROVIDER} from "nest-winston";
import {OpenAiService} from "./open-ai.service";
import { RedisService } from "./redis.service";

export interface UpsertProspectParams {
    _id: string,
    timezone: string,
    locale: 'en-US' | 'en-MX',
    triggered_intents: string[],
    first_name: string,
    last_name: string,
    phone: string,
    email_address: string,
    conversation_id: string,
    conversation_type: string,
    apartment_size: string,
    move_in_date: string,
    attribution_type: string,
    attribution_value: string,
    referrer_id: string,
    utm: any,
    sms_opt_in: boolean,
    sms_opt_in_source: string,
    campaign_id: number
}

export interface ConversationLog {
    from: 'bot' | 'user',
    direction: 'in' | 'out',
    body: string,
    timestamp: Date
}

@Injectable()
export class ResmateService {
    private readonly headers: {Authorization: string};

    static generateConversationLog(chatHistory: Array<ChatHistoryLog>) {
        return [
            {
                from: 'user',
                direction: 'in',
                body: '[Call Initiated]',
                timestamp: chatHistory[0].timestamp
            },
            ...chatHistory.map(x => {
                return {
                    from: x.role === 'assistant' ? 'bot' : 'user',
                    direction: x.role === 'assistant' ? 'out' : 'in',
                    body: x.content,
                    timestamp: x.timestamp
                };
            })
        ]
    }

    async mapExistingProspectInfo(prospect: any) {
        let tour_date_time;
        if (prospect.tour_reservation) {
            try {
                const reservation = await this.getTourReservation(prospect.tour_reservation);
                if (reservation) {
                    const start_time = DateTime.fromISO(reservation.start_time, {zone: prospect.timezone});
                    if (+start_time > +DateTime.now()) {
                        tour_date_time = start_time;
                    }
                }
            } catch (e) {
                this.logger.error("VoiceService startCall getProspect getTourReservation", {e});
            }
        }

        let communicationConsent;
        try {
            communicationConsent = await this.getCommunicationConsent(prospect.phone, prospect.campaign_id, 'sms');
        } catch (e) {
            this.logger.error("VoiceService startCall getProspect getCommunicationConsent", {e});
        }

        const {
            _id,
            first_name,
            last_name,
            email_address,
            phone,
            interests
        } = prospect;

        const mapped: ConversationInfo = {
            prospect: {
                _id,
                first_name,
                last_name,
                email_address,
                phone,
                interests,
                campaign_id: prospect.campaign_id
            },
            first_name: prospect.first_name,
            last_name: prospect.last_name,
            sms_consent: communicationConsent,
        };

        if (tour_date_time) {
            mapped.tour_date_time = tour_date_time;
            mapped.tour_scheduled = !!tour_date_time;
            mapped.tour_date_time_confirmed = !!tour_date_time;
        }

        return mapped;
    }

    constructor(
        @Inject(forwardRef(() => RedisService)) private redisService: RedisService,
        @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
    ) {
        this.headers = {
            Authorization: `Basic ${Buffer.from(process.env.RESMATE_AUTH_USERNAME + ':' + process.env.RESMATE_AUTH_KEY).toString('base64')}`
        };
    }

    async getVoiceInbox(phone_number: string) {
        const response = await axios({
            url: `${process.env.RESMATE_API_URL}/private/voice/inbox`,
            method: 'GET',
            params: { phone_number },
            headers: this.headers
        });

        return response.data.data;
    }

    async getTourTimes(campaign_id: number, start_date: string, max_count: number): Promise<{availableTimes: string[], blockedTimes: string[]}> {
        try {
            const response = await axios({
                url: `${process.env.RESMATE_API_URL}/tour/tour-times`,
                method: 'GET',
                params: { campaign_id, start_date, max_count },
                headers: this.headers
            });

            return response.data.data || {availableTimes: [], blockedTimes: []};
        } catch (e) {
            console.error('getTourDateData error'/*, {e}*/);
            return {availableTimes: [], blockedTimes: []};
        }
    }

    async getProspect(campaign_id: number, phone: string) {
        const response = await axios({
            method: "GET",
            url: `${process.env.RESMATE_API_URL}/private/prospect/${campaign_id}/identify`,
            params: { phone },
            headers: this.headers
        });

        return response.data.data;
    }

    async getTourReservation(reservation_id: string) {
        const response = await axios({
            method: "GET",
            url: `${process.env.RESMATE_API_URL}/private/tour/${reservation_id}`,
            headers: this.headers
        });

        return response.data.data;
    }

    async getCommunicationConsent(contact: string, campaign_id: number, channel: string) {
        const response = await axios({
            method: "GET",
            url: `${process.env.RESMATE_API_URL}/private/communication-consent/${channel}/${campaign_id}/${contact}`,
            headers: this.headers
        });

        return !!(response.data?.data?.active && response.data?.data?.status === 'opted_in');
    }

    async ensureProspect(call: ActiveCall, additionalUpsert = {}) {
        if (!call.conversation.conversationInfo.prospect._id) {
            const upsert = {
                ...call.conversation.conversationInfo.prospect,
                locale: 'en-US',
                ...(await this.getAttributionInfo(call.to_number)),
                await_external_integration_ids: true,
                ...additionalUpsert
            };

            const newProspect = await this.upsertProspect(call.conversation.campaign_id, upsert);
            call.updateSystemPrompt(null, await this.mapExistingProspectInfo(newProspect));
        } else if (Object.keys(additionalUpsert).length) {
            await this.upsertProspect(
                call.conversation.campaign_id,
                {
                    _id: call.conversation.conversationInfo.prospect._id,
                    phone: call.conversation.conversationInfo.prospect.phone || call.conversation.conversationInfo.phone,
                    ...additionalUpsert
                }
            );
        }
    }

    async upsertProspect(campaign_id: number, data: Partial<UpsertProspectParams>) {
        const response = await axios({
            method: "POST",
            url: `${process.env.RESMATE_API_URL}/prospect/${campaign_id}/upsert`,
            data,
            headers: this.headers
        });

        return response.data.data;
    }

    async addConversation(prospect_id: string, call: ActiveCall) {
        const callHistory = call.conversation.getCallHistory();
        const response = await axios({
            method: "POST",
            url: `${process.env.RESMATE_API_URL}/private/conversation/${call.conversation.campaign_id}/${prospect_id}`,
            data: {
                type: 'voice',
                contact: {user_phone: call.conversation.conversationInfo.phone},
                locale: 'en-US',
                status: 'closed',
                service_id: call.conversation_id,
                logs: ResmateService.generateConversationLog(callHistory)
            },
            headers: this.headers
        });

        return response.data.data;
    }

    async updateConversation(service_id: string, update: any) {
        const response = await axios({
            method: "PUT",
            url: `${process.env.RESMATE_API_URL}/private/conversation?service_id=${service_id}`,
            data: { update },
            headers: this.headers
        });

        return response.data.data;
    }

    async scheduleTour(call: ActiveCall) {
        let {
            move_in_date,
            unit_type,
            first_name,
            last_name,
            tour_date_time,
            interests,
            prospect
        } = call.conversation.conversationInfo;

        const { tour_length, timezone } = call.conversation.propertyInfo.tour_availability;
        const { schedule_tour_options } = call.conversation.propertyInfo;

        const tourDateTimeUTC = tour_date_time.toUTC();

        const basicReservation = {
            start_time: tourDateTimeUTC.toISO(),
            end_time: tourDateTimeUTC.plus({minutes: tour_length}).toISO(),
            campaign_id: call.conversation.campaign_id,
            prospect_id: prospect._id,
            name: `${first_name ? first_name + " " : ''}${last_name || ''}`,
        }

        let remoteReservationResponse;
        try {
            remoteReservationResponse = await axios({
                url: `${process.env.RESMATE_API_URL}/tour-integration/reservations`,
                method: 'POST',
                data: {
                    data: {
                        reservation: {
                            ...basicReservation,
                            _id: null,
                            move_in_date: move_in_date ? move_in_date.toISO() : null,
                            unit_type: unit_type,
                            message: interests?.length ? `Prospect is interested in ${interests.join(', ')}` : null,
                        },
                        prospect,
                        integration_options: schedule_tour_options,
                        notification_type: 'voice'
                    },
                    timezone
                }
            });
        } catch (e) {
            this.logger.error("Failed to schedule remote reservation", {prospect, e});
            remoteReservationResponse = null;
        }

        const reservationResponse = await axios({
            url: `${process.env.RESMATE_API_URL}/tour/reservations/upsert`,
            method: 'POST',
            data: {
                timezone,
                data: {
                    reservation: {
                        ...basicReservation,
                        tour_end_time: basicReservation.end_time,
                        is_recurring: false,
                        status: 'approved',
                        timezone,
                        external_integration_response: remoteReservationResponse?.data?.data,
                    },
                    update_prospect_send_notification: 'voice'
                }
            }
        });

        return reservationResponse.data.data;
    }

    async escalateToHumanContact(call: ActiveCall, custom?: string) {
        const data = {
            prospect_id: call.conversation.conversationInfo.prospect._id,
            conversation: {
                log: ResmateService.generateConversationLog(call.conversation.getCallHistory())
            },
        };

        await axios({
            url: `${process.env.RESMATE_API_URL}/private/prospect/escalate`,
            method: 'PUT',
            headers: this.headers,
            data: {
                data,
                reason: "LLM",
                conversationType: "voice",
                custom
            }
        });
    }

    async isDuringOfficeHours(campaign_id: number, timezone: string = 'America/New_York', time: DateTime = DateTime.local({zone: timezone})) {
        const timeISO = time.toISO();
        const response = await axios({
            url: `${process.env.RESMATE_API_URL}/private/settings/${campaign_id}/hours?start=${timeISO}&end=${timeISO}`,
            method: 'GET',
            headers: this.headers
        });

        const hours = response.data?.data?.[0];

        if (!hours) {
            return false;
        }

        const open = DateTime.fromFormat(`${time.year} ${time.month} ${time.day} ${hours.start_hour}`, 'y M d t', {zone: timezone});
        const close =  DateTime.fromFormat(`${time.year} ${time.month} ${time.day} ${hours.end_hour}`, 'y M d t', {zone: timezone});

        if (!open.isValid || !close.isValid) {
            this.logger.error("isDuringOfficeHours open and / or close not valid", {open, close});
            return false;
        }
        this.logger.info("isDuringOfficeHours", {open, close});
        return +open < +time && +close > +time;
    }

    async getTrackingNumberInfo(trackingNumber: string) {
        const response = await axios({
            url: `${process.env.RESMATE_API_URL}/private/tracking-numbers/${trackingNumber}`,
            method: 'GET',
            headers: this.headers
        });

        return response.data.data;
    }

    async getAttributionInfo(to_number: string) {
        let attribution_type = 'voice';
        let attribution_value = 'voice';
        let utm;
        try {
            const answeredTrackingCallData = await this.redisService.getAnsweredTrackingCallData(to_number);
            this.logger.info("answeredTrackingCallData", {to_number, answeredTrackingCallData});
            if (answeredTrackingCallData) {
                const trackingNumberInfo = await this.getTrackingNumberInfo(answeredTrackingCallData.trackingNumber);
                this.logger.info("trackingNumberInfo", {trackingNumberInfo});
                
                let utm;
                if (trackingNumberInfo?.utm) {
                    // We have to convert utm settings to match attribution_source utm properties
                    utm = Object.entries(trackingNumberInfo.utm).reduce((acc, [key, value]) => {
                        if (!key.startsWith('utm_')) {
                            acc[`utm_${key}`] = value;
                        } else {
                            acc[key] = value;
                        }
                        return acc;
                    }, {});
                }
                if (utm?.utm_source) {
                    this.logger.info(`trackingNumberInfo.utm.source: ${trackingNumberInfo.utm.source}`);
                    attribution_type = 'external';
                    attribution_value = utm.utm_source;
                }
            }
        } catch (e) {
            this.logger.error("VoiceService startCall failed to get answered tracking call data", {e});
        }

        return {attribution_type, attribution_value, utm};
    }
}
