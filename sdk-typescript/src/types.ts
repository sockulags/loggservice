/**
 * Log level types
 */
export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

/**
 * Context object for additional log data
 */
export interface LogContext {
  [key: string]: any;
}

/**
 * Log entry structure
 */
export interface LogEntry {
  level: LogLevel;
  message: string;
  context?: LogContext;
  correlation_id?: string;
}

/**
 * SDK configuration options
 */
export interface LoggplattformSDKOptions {
  /** API URL for the logging platform */
  apiUrl?: string;
  /** API key for authentication */
  apiKey?: string;
  /** Service name */
  service?: string;
  /** Environment name */
  environment?: string;
  /** Default correlation ID for all logs */
  correlationId?: string;
  /** Flush interval in milliseconds (0 to disable auto-flush) */
  flushInterval?: number;
  /** Batch size for sending logs */
  batchSize?: number;
}
