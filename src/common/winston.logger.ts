import * as winston from 'winston';
import * as DailyRotateFile from 'winston-daily-rotate-file';

// Cache for logger instances to avoid creating multiple loggers for the same service
const loggerCache = new Map<string, winston.Logger>();

/**
 * Tạo Winston logger cho cronjob services
 * @param serviceName Tên service (vd: 'DatabaseCleanupCronjobService')
 * @returns Winston logger instance
 */
export function getWinstonLogger(serviceName: string): winston.Logger {
  // Return cached logger if exists
  if (loggerCache.has(serviceName)) {
    return loggerCache.get(serviceName)!;
  }

  // Custom format for log messages
  const logFormat = winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss',
    }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ level, message, timestamp, stack, ...meta }) => {
      // Format: [2025-09-15 23:00:01] [INFO] [DatabaseCleanupCronjobService] Message
      let logMessage = `[${timestamp}] [${level.toUpperCase()}] [${serviceName}] ${message}`;
      
      // Add stack trace for errors
      if (stack) {
        logMessage += `\n${stack}`;
      }
      
      // Add extra metadata if present
      if (Object.keys(meta).length > 0) {
        logMessage += `\n${JSON.stringify(meta, null, 2)}`;
      }
      
      return logMessage;
    })
  );

  // Create daily rotate file transport for cronjobs
  // Sanitize service name to be file-system friendly
  const sanitize = (name: string) =>
    name
      .replace(/[^a-zA-Z0-9-_]/g, '-')
      .replace(/-+/g, '-')
      .toLowerCase()
      .slice(0, 200);

  const safeName = sanitize(serviceName || 'cronjob');

  const fileTransport = new DailyRotateFile({
    filename: `logs/${safeName}-%DATE%.log`,
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxSize: '20m',
    maxFiles: '14d', // Keep logs for 14 days
    format: logFormat,
  });

  // Console transport with colors for development
  const consoleTransport = new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      logFormat
    ),
  });

  // Create logger instance
  const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    transports: [
      fileTransport,
      consoleTransport,
    ],
    // Exit on error false to prevent process exit
    exitOnError: false,
  });

  // Cache the logger
  loggerCache.set(serviceName, logger);

  return logger;
}

/**
 * Winston logger wrapper class tương thích với NestJS Logger interface
 */
export class WinstonLogger {
  private readonly logger: winston.Logger;

  constructor(private readonly serviceName: string) {
    this.logger = getWinstonLogger(serviceName);
  }

  log(message: string, ...optionalParams: any[]) {
    this.logger.info(message, ...optionalParams);
  }

  error(message: string, trace?: string, ...optionalParams: any[]) {
    this.logger.error(message, { trace, ...optionalParams });
  }

  warn(message: string, ...optionalParams: any[]) {
    this.logger.warn(message, ...optionalParams);
  }

  debug(message: string, ...optionalParams: any[]) {
    this.logger.debug(message, ...optionalParams);
  }

  verbose(message: string, ...optionalParams: any[]) {
    this.logger.verbose(message, ...optionalParams);
  }

  info(message: string, ...optionalParams: any[]) {
    this.logger.info(message, ...optionalParams);
  }
}