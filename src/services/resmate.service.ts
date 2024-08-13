import winston from "winston";
import axios from "axios";
import {Injectable} from "@nestjs/common";
import {DateTime} from "luxon";
import {ChatHistoryLog, Conversation, ConversationInfo, PropertyInfo} from "../models/conversation.model";
import {ActiveCall} from "../models/active-call.model";

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
    private readonly headers = {
        Authorization: `Basic ${process.env.RESMATE_BASIC_AUTH_ENCODED}`
    };

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

    async getVoiceInbox(phone_number: string) {
        const response = await axios({
            url: `${process.env.RESMATE_API_URL}/private/voice/inbox`,
            method: 'GET',
            params: { phone_number },
            headers: this.headers
        });

        return response.data.data;
    }

    async getTourTimes(campaign_id: number, start_date: string, max_count: number): Promise<string[]> {
        try {
            const response = await axios({
                url: `${process.env.RESMATE_API_URL}/tour/tour-times`,
                method: 'GET',
                params: { campaign_id, start_date, max_count },
                headers: this.headers
            });

            return response.data.data || [];
        } catch (e) {
            console.error('getTourDateData error'/*, {e}*/);
            return Promise.resolve(null);
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

    async upsertProspect(campaign_id: number, data: Partial<UpsertProspectParams>) {
        const response = await axios({
            method: "POST",
            url: `${process.env.RESMATE_API_URL}/prospect/${campaign_id}/upsert`,
            data,
            headers: this.headers
        });

        return response.data.data;
    }

    async addConversation(call: ActiveCall) {
        const callHistory = call.conversation.getCallHistory();
        const response = await axios({
            method: "POST",
            url: `${process.env.RESMATE_API_URL}/private/conversation/${call.conversation.campaign_id}/${call.conversation.conversationInfo.prospect._id}`,
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

    async scheduleTour(conversation: Conversation) {
        const {
            move_in_date,
            unit_type,
            first_name,
            last_name,
            tour_date_time,
            interests,
            prospect
        } = conversation.conversationInfo;

        const { tour_length, timezone } = conversation.propertyInfo.tour_availability;
        const { schedule_tour_options } = conversation.propertyInfo;

        const tourDateTimeUTC = tour_date_time.toUTC();

        const basicReservation = {
            start_time: tourDateTimeUTC.toUTC().toISO(),
            end_time: tourDateTimeUTC.plus({minutes: tour_length}).toISO(),
            campaign_id: conversation.campaign_id,
            prospect_id: prospect._id,
            name: `${first_name ? first_name + " " : ''}${last_name || ''}`,
        }

        const remoteReservationResponse = await axios({
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
                        external_integration_response: remoteReservationResponse.data.data,
                    },
                    update_prospect_send_notification: 'voice'
                }
            }
        });

        return reservationResponse.data.data;
    }

    async escalateToHumanContact(call: ActiveCall, custom?: string) {
        const data = {
            prospect: call.conversation.conversationInfo.prospect || {
                first_name: call.conversation.conversationInfo.first_name,
                last_name: call.conversation.conversationInfo.last_name,
                campaign_id: call.conversation.campaign_id,
                phone: call.conversation.conversationInfo.prospect.conversationInfo.phone,
            },
            conversation: {
                log: ResmateService.generateConversationLog(call.conversation.getCallHistory())
            },
        };

        const result = await axios({
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

        console.log(result);
    }

    async isDuringOfficeHours(campaign_id: number, time: DateTime = DateTime.now()) {
        const timeISO = time.toISO();
        const response = await axios({
            url: `${process.env.RESMATE_API_URL}/private/settings/${campaign_id}/hours?start=${timeISO}&end=${timeISO}`,
            method: 'GET',
            headers: this.headers
        });
        console.log(response.data?.data);
        const hours = response.data?.data?.[0];

        if (!hours) {
            return false;
        }

        const open = DateTime.fromFormat(`${time.year} ${time.month} ${time.day} ${hours.start_hour}`, 'y M d t');
        const close =  DateTime.fromFormat(`${time.year} ${time.month} ${time.day} ${hours.end_hour}`, 'y M d t');

        if (!open.isValid || !close.isValid) {
            return false;
        }

        return +open < +time && +close > +time;
    }
}
