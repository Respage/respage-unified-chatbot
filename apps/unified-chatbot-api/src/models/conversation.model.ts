import {ChatCompletionMessageParam} from "openai/src/resources/chat/completions";
import {DateTime} from "luxon";

export interface PropertyInfo {
    preleasing_date?: string;
    apt_feature_custom_texts?: any;
    availability?: any;
    apt_features?: any[];
    custom_responses?: any[];
    special_offer?: any[];
    leasing_application_url?: string;
    office_hours?: any;
    physical_address?: string;
    email_address?: string;
    phone_number?: string;
    some_available_tour_times?: string [];
    blocked_tour_times?: string[];
    call_forwarding_number?: string,
    tour_availability?: {
        campaign_id?: number;
        name?: string;
        buffer_between_tour_times_in_minutes?: number;
        tour_length?: number;
        closest_possible_tour_available_in_hours?: number;
        timezone?: string;
        // ...
    },
    schedule_tour_options?: any;
    timezone?: string;
}

export interface ConversationInfo {
    first_name?: string;
    last_name?: string;
    phone?: string;
    sms_consent?: boolean;
    tour_scheduled?: boolean;
    tour_date_time_confirmed?: boolean;
    tour_date?: DateTime;
    tour_time?: string;
    tour_date_time?: DateTime;
    prospect?: any;
    reservation_id?: string;
    move_in_date?: DateTime;
    unit_type?: string;
    interests?: string[];
    is_during_office_hours?: boolean;
}

export type ChatHistoryLog = ChatCompletionMessageParam & { timestamp?: Date };

export type ConversationType = 'voice' | 'chatbot';

const SYSTEM_PROMPTS = {
    'voice': process.env.SYSTEM_PROMPT_VOICE,
    'voice_no_tours': process.env.SYSTEM_PROMPT_VOICE_NO_TOURS
};

function selectSystemPrompt(type: ConversationType, tours?: boolean): string {
    return SYSTEM_PROMPTS[type + (tours ? "" : "_no_tours")];
}

export class Conversation {
    readonly campaign_id: number

    type: ConversationType;
    propertyInfo: PropertyInfo;
    conversationInfo: ConversationInfo;
    timezone: string;

    private systemPrompt: ChatCompletionMessageParam;

    private conversationHistory: Array<ChatHistoryLog>;

    private conversationMemory: Array<ChatHistoryLog>;
    private conversationMemorySize: number;

    functions: any[] = [];

    constructor(campaign_id: number, conversationType: ConversationType, timezone: string, callMemorySize = 20, offerTours: boolean = true) {
        this.type = conversationType;
        this.campaign_id = campaign_id;
        this.timezone = timezone;

        this.systemPrompt = {
            role: 'system',
            content: `Today's date is ${DateTime.local({zone: timezone}).toISODate()}. ` + (offerTours ? process.env.SYSTEM_PROMPT_VOICE : process.env.SYSTEM_PROMPT_VOICE_NO_TOURS)
        };

        this.conversationHistory = [];
        this.conversationMemory = [];
        this.conversationMemorySize = callMemorySize;
    }

    updateSystemPrompt(propertyInfoUpdate?: PropertyInfo, conversationInfoUpdate?: ConversationInfo) {
        if (!this.propertyInfo) {
            this.propertyInfo = propertyInfoUpdate;
        } else if (propertyInfoUpdate) {
            this.propertyInfo = {...this.propertyInfo, ...propertyInfoUpdate};
        }

        if (!this.conversationInfo) {
            this.conversationInfo = conversationInfoUpdate;
        } else if (conversationInfoUpdate) {
            this.conversationInfo = {...this.conversationInfo, ...conversationInfoUpdate};
        }

        let content = selectSystemPrompt(this.type, !!this.propertyInfo.tour_availability)
            .replace("{{DATE_TODAY}}", (new Date()).toString().split(/\d\d:\d\d:\d\d/)[0].trim())
            .replace("{{PROPERTY_INFO}}", JSON.stringify(this.propertyInfo || {}))
            .replace("{{CONVERSATION_INFO}}", JSON.stringify(this.conversationInfo || {}));

        this.systemPrompt = { role: 'system', content };
    }

    updateCallHistory(message: ChatHistoryLog) {
        message.timestamp = new Date();
        this.conversationHistory.push(message);

        if (this.conversationMemory.length === this.conversationMemorySize) {
            this.conversationMemory.shift();
        }

        this.conversationMemory.push(message);
    }

    getCallMessageWindow() {
        return [this.systemPrompt, ...this.conversationMemory];
    }

    getSystemPrompt() {
        return this.systemPrompt;
    }

    getCallHistory(conversant?: 'user' | 'assistant') {
        if (conversant) {
            return this.conversationHistory.filter(x => x.role === conversant);
        }

        return this.conversationHistory;
    }
}
