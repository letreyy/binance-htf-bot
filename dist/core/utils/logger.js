import winston from 'winston';
import 'winston-daily-rotate-file';
const logFormat = winston.format.printf(({ level, message, timestamp, ...metadata }) => {
    let msg = `${timestamp} [${level.toUpperCase()}]: ${message}`;
    if (Object.keys(metadata).length > 0) {
        msg += ` ${JSON.stringify(metadata)}`;
    }
    return msg;
});
export const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), winston.format.metadata({ fillExcept: ['message', 'level', 'timestamp'] }), logFormat),
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(winston.format.colorize(), logFormat)
        }),
        new winston.transports.DailyRotateFile({
            filename: 'logs/error-%DATE%.log',
            datePattern: 'YYYY-MM-DD',
            level: 'error',
            maxFiles: '14d'
        }),
        new winston.transports.DailyRotateFile({
            filename: 'logs/combined-%DATE%.log',
            datePattern: 'YYYY-MM-DD',
            maxFiles: '14d'
        })
    ]
});
//# sourceMappingURL=logger.js.map