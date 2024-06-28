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
    available_tour_times?: string [];
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
}

export interface ConversationInfo {
    first_name?: string;
    last_name?: string;
    phone?: string;
    sms_consent?: boolean;
    tour_scheduled?: boolean;
    tour_date_time_confirmed?: boolean;
    tour_date_time?: DateTime;
    prospect?: any;
    reservation_id?: string;
    move_in_date?: DateTime;
    unit_type?: string;
    interests?: string[];
}

export type ChatHistoryLog = ChatCompletionMessageParam & { timestamp?: Date };

export class Conversation {
    readonly campaign_id: number

    propertyInfo: PropertyInfo;
    conversationInfo: ConversationInfo;

    private systemPrompt: ChatCompletionMessageParam;

    private callHistory: Array<ChatHistoryLog>;

    private callMemory: Array<ChatHistoryLog>;
    private callMemorySize: number;

    functions: any[] = [];

    constructor(campaign_id: number, callMemorySize = 10) {
        this.campaign_id = campaign_id;

        this.systemPrompt = {
            role: 'system',
            content: `Today's date is ${(new Date()).toString().split(/\d\d:\d\d:\d\d/)[0].trim()}. ` + process.env.SYSTEM_PROMPT_VOICE
        };

        this.callHistory = [];
        this.callMemory = [];
        this.callMemorySize = callMemorySize;
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

        let content = `Today's date is ${(new Date()).toString().split(/\d\d:\d\d:\d\d/)[0].trim()}. ` +
                        process.env.SYSTEM_PROMPT_VOICE +
                        "\nYou know the follow information about this user and conversation, it is in JSON format:\n" +
                        JSON.stringify(this.conversationInfo || {}) +
                        "\nYou know the following information about the property, it is in JSON format:\n" +
                        JSON.stringify(this.propertyInfo || {}) + "\n";



        console.log(this.conversationInfo);
        this.systemPrompt = { role: 'system', content };
    }

    updateCallHistory(message: ChatHistoryLog) {
        message.timestamp = new Date();
        this.callHistory.push(message);

        if (this.callMemory.length === this.callMemorySize) {
            this.callMemory.shift();
        }

        this.callMemory.push(message);
    }

    getCallMessageWindow() {
        return [this.systemPrompt, ...this.callMemory];
    }

    getCallHistory() {
        return this.callHistory;
    }
}
