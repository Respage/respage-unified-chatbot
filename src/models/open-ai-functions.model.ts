const SCHEDULE_TOUR_FUNCTION = {
    name: "collect_tour_information",
    description: "Called whenever new information about a tour request is provided.",
    parameters: {
        type: "object",
        properties: {
            year: {type: "string", description: "Year of the tour. Default: Current Year."},
            month: {type: "string", description: "Month of the tour. Valid values: January, February, March, April, May, June, July, August, September, October, November, December."},
            day: {type: "string", description: "Calendar day of the tour."},
            time: {type: "string", description: "Time of the tour in military time."},
            sms_consent: {type: "boolean", description: "True if the user consents to SMS messages."},
            tour_confirmed: {type: "boolean", description: "True if the tour date and time has been confirmed by the user."},
        },
        required: []
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
            tour_date_time: {type: "string", description: "The date and time a user wishes to tour the property. format: ISODate"},
            tour_confirmed: {type: "boolean", description: "True if the tour date and time has been confirmed by the user."},
            tour_scheduled: {type: "boolean", description: "True if the tour was scheduled."},
            sms_consent: {type: "boolean", description: "True if the user consents to SMS messages."},
            apartment_size: {type: "string", description: "The size of apartment the user is interested in. Valid Values: 1BR, 2BR, 3BR, etc."},
            interests: {type: "string", description: "A comma separated list of amenities, etc. that the user expressed interest in."},
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
    COLLECT_USER_INFO_FUNCTION,
    TALK_TO_HUMAN_FUNCTION
};
