const SCHEDULE_TOUR_FUNCTION = {
    name: "schedule_tour",
    description: "Schedule a tour on a specific day and time.",
    parameters: {
        type: "object",
        properties: {
            year: {type: "string", description: "Year of the tour. Default: Current Year."},
            month: {type: "string", description: "Month of the tour. Valid values: January, February, March, April, May, June, July, August, September, October, November, December."},
            day: {type: "string", description: "Calendar day of the tour."},
            time: {type: "string", description: "Time of the tour in military time."},
            tour_confirmed: {type: "boolean", description: "True if the tour date and time has been confirmed by the user."},
            sms_consent: {type: "boolean", description: "True if the user consents to SMS messages."},
        },
        required: ['tour_confirmed']
    }
};

const SAVE_SMS_CONSENT_FUNCTION = {
    name: "save_sms_consent",
    description: "Save response to request for consent to send SMS messages.",
    parameters: {
        type: "object",
        properties: {
            sms_consent: {type: "boolean", description: "True if the user consents to SMS messages."},
        },
        required: ['sms_consent']
    }
}

const LOOKUP_TOUR_TIMES_FUNCTION = {
    name: "look_up_tour_times",
    description: "Check for tour availability on a specific date.",
    parameters: {
        type: "object",
        properties: {
            year: {type: "string", description: "Year of the tour. Default: Current Year."},
            month: {type: "string", description: "Month of the tour. Valid values: January, February, March, April, May, June, July, August, September, October, November, December."},
            day: {type: "string", description: "Calendar day of the tour."},
            time: {type: "string", description: "Time of the tour in military time."},
        },
        required: ['month', 'day']
    }
};

const COLLECT_USER_INFO_FUNCTION = {
    name: "collect_user_info",
    description: "Collect information about the user.",
    parameters: {
        type: "object",
        properties: {
            first_name: {type: "string", description: "the User's first name."},
            last_name: {type: "string", description: "the User's last name."},
            move_in_day: {type: "string", description: "Calendar day the user would like to move in."},
            move_in_month: {type: "string", description: "Month the user would like to move in. Valid values: January, February, March, April, May, June, July, August, September, October, November, December."},
            move_in_year: {type: "string", description: "Year the user would like to move in. Default: Current Year."},
            tour_date_time: {type: "string", description: "The date and time a user wishes to tour the property. format: ISO Date. Example: 2024-08-01T05:00:00.000Z"},
            tour_confirmed: {type: "boolean", description: "True if the tour date and time has been confirmed by the user."},
            tour_scheduled: {type: "boolean", description: "True if the tour was scheduled."},
            sms_consent: {type: "boolean", description: "True if the user consents to SMS messages."},
            apartment_size: {type: "string", description: "The size of apartment the user is interested in. Valid Values: 1BR, 2BR, 3BR, etc."},
            interests: {type: "string", description: "A comma separated list of things that the user themselves expressed interest in. Examples: 2 bedroom apartment, location, pool, pet policy, tours, apartment availability."},
            talk_to_human: {type: "boolean", description: "Set to true if the user clearly wanted to talk to a human representative at any point in the call."}
        },
        required: []
    }
};

const TALK_TO_HUMAN_FUNCTION = {
    name: "talk_to_human",
    description: "Connect The user with a human being because they are getting overly frustrated, or wish to speak to a human being.",
    parameters: {
        type: "object",
        properties: {
            reason: {type: "string", description: "The reason the user should be put in contact with a human being."}
        },
        required: ["reason"]
    }
};

export {
    SCHEDULE_TOUR_FUNCTION,
    LOOKUP_TOUR_TIMES_FUNCTION,
    COLLECT_USER_INFO_FUNCTION,
    TALK_TO_HUMAN_FUNCTION,
    SAVE_SMS_CONSENT_FUNCTION
};
