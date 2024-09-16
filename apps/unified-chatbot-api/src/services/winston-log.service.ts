import * as winston from 'winston';

let initialized = false;

const customFormatter = info => {
    for (const key of Object.keys(info)) {
        if (info[key] instanceof Error) {
            info[key] = Object.assign({
                message: info[key].message,
                stack: info[key].stack
            }, info[key]);
        } else if (key === 'message' && info[key] instanceof Object) {
            info[key] = customFormatter(info[key]);
        }
    }

    return info;
};

const init = () => {
    if (initialized) {
        return;
    }

    winston.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format(customFormatter)(),
            winston.format.json()
        )
    }));

    initialized = true;
};

export {
    init,
    customFormatter
};
