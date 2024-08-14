import {DateTime} from "luxon";

export const FUNC_SCHEDULE_TOUR = {
    name: "schedule_tour",
    description: "User wishes to schedule a tour of the property",
    parameters: {
        type: "object",
        properties: {
            year: {type: "string", description: "Year of the tour. Default: Current Year."},
            month: {type: "string", description: "Month of the tour. REQUIRED. Valid values: January, February, March, April, May, June, July, August, September, October, November, December."},
            day: {type: "string", description: "Calendar day of the tour. REQUIRED."},
            time: {type: "string", description: "Time of the tour in military time. REQUIRED."},
            tour_confirmed: {type: "boolean", description: "Set to true if tour date and time have been confirmed by the user."},
            first_name: {type: "string", description: "User's first name"},
            last_name: {type: "string", description: "User's last name"},
            consent_to_sms: {type: "boolean", description: "Set to true if user consented to SMS communications."},
            move_in_day: {type: "string", description: "Calendar day the user would like to move in."},
            move_in_month: {type: "string", description: "Month the user would like to move in. Valid values: January, February, March, April, May, June, July, August, September, October, November, December."},
            move_in_year: {type: "string", description: "Year the user would like to move in. Default: Current Year."},
        }
    }
};

export const FUNC_LOOKUP_TOUR_TIMES = {
    name: "tour_time_lookup",
    description: "Check if tour times are available on a specific day or at a specific time when that data is not available.",
    parameters: {
        type: "object",
        properties: {
            year: {type: "string", description: "Year of the tour. Default: Current Year."},
            month: {type: "string", description: "Month of the tour. Valid values: January, February, March, April, May, June, July, August, September, October, November, December."},
            day: {type: "string", description: "Calendar day of the tour."},
            time: {type: "string", description: "Time of the tour in military time."},
        }
    }
}

export const FUNC_COLLECT_USER_INFO = {
    name: "collect_user_info",
    description: "Collect information about the user.",
    parameters: {
        type: "object",
        properties: {
            first_name: {type: "string", description: "the User's first name. OPTIONAL"},
            last_name: {type: "string", description: "the User's last name. OPTIONAL"},
            move_in_day: {type: "string", description: "Calendar day the user would like to move in. OPTIONAL"},
            move_in_month: {type: "string", description: "Month the user would like to move in. Valid values: January, February, March, April, May, June, July, August, September, October, November, December. OPTIONAL"},
            move_in_year: {type: "string", description: "Year the user would like to move in. Default: Current Year. OPTIONAL"},
            apartment_size: {type: "string", description: "The size of apartment the user is interested in. Valid Values: 1BR, 2BR, 3BR, etc. OPTIONAL"},
            interests: {type: "string", description: "A comma separated list of amenities, etc. that the user expressed interest in. OPTIONAL"},
            talk_to_human: {type: "boolean", description: "Set to true if the user clearly wanted to talk to a human representative at any point in the call. OPTIONAL"}
        }
    }
};

export const FUNC_TALK_TO_HUMAN = {
    name: "talk_to_human",
    description: "The user is getting overly frustrated, or wishes to speak to a human being.",
    parameters: {
        type: "object",
        properties: {
            reason: {type: "string", description: "The reason the user should be put in contact with a human being."}
        }
    }
};

export const FUNCTIONS = {
    "schedule_tour": FUNC_SCHEDULE_TOUR,
    "tour_time_lookup": FUNC_LOOKUP_TOUR_TIMES,
    "collect_user_info": FUNC_COLLECT_USER_INFO,
    "talk_to_human": FUNC_TALK_TO_HUMAN
};
