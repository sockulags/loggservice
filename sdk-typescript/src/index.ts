import axios, { AxiosInstance } from 'axios';
import { v4 as uuidv4 } from 'uuid';
import {
  LogLevel,
  LogContext,
  LogEntry,
  LoggplattformSDKOptions
} from './types';

/**
 * Loggplattform SDK for TypeScript
 * 
 * Central logging platform SDK with async sending and automatic metadata.
 * SDK errors never crash the application.
 */
export class LoggplattformSDK {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly service: string;
  private readonly environment: string;
  private correlationId?: string;
  private readonly flushInterval: number;
  private readonly batchSize: number;

  private logQueue: LogEntry[] = [];
  private flushTimer?: NodeJS.Timeout;
  private readonly httpClient: AxiosInstance;

  /**
   * Create a new LoggplattformSDK instance
   * 
   * @param options SDK configuration options
   */
  constructor(options: LoggplattformSDKOptions = {}) {
    this.apiUrl = options.apiUrl || 
      process.env.LOGGPLATTFORM_API_URL || 
      'http://localhost:3000';
    this.apiKey = options.apiKey || 
      process.env.LOGGPLATTFORM_API_KEY || 
      '';
    this.service = options.service || 
      process.env.LOGGPLATTFORM_SERVICE || 
      'default-service';
    this.environment = options.environment || 
      process.env.NODE_ENV || 
      'development';
    this.correlationId = options.correlationId;
    this.flushInterval = options.flushInterval ?? 5000;
    this.batchSize = options.batchSize ?? 10;

    if (!this.apiKey) {
      console.warn('Loggplattform SDK: No API key provided. Logs will not be sent.');
    }

    // Create HTTP client with timeout
    this.httpClient = axios.create({
      timeout: 5000,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // Start periodic flush if interval is set
    if (this.flushInterval > 0) {
      this.flushTimer = setInterval(() => this.flush(), this.flushInterval);
    }

    // Flush on process exit
    this.setupShutdownHandlers();
  }

  /**
   * Setup shutdown handlers to flush logs on exit
   */
  private setupShutdownHandlers(): void {
    const flushSync = () => this.flushSync();

    process.on('exit', flushSync);
    process.on('SIGINT', () => {
      flushSync();
      process.exit();
    });
    process.on('SIGTERM', () => {
      flushSync();
      process.exit();
    });
  }

  /**
   * Create a log entry with automatic metadata
   */
  private createLogEntry(
    level: LogLevel,
    message: string,
    context: LogContext = {}
  ): LogEntry {
    const fullContext: LogContext = {
      ...context,
      environment: this.environment,
      service: this.service
    };

    return {
      level,
      message,
      context: fullContext,
      correlation_id: this.correlationId || context.correlation_id
    };
  }

  /**
   * Queue a log entry for async sending
   */
  private queueLog(logEntry: LogEntry): void {
    try {
      this.logQueue.push(logEntry);

      // Auto-flush if queue reaches batch size
      if (this.logQueue.length >= this.batchSize) {
        this.flush();
      }
    } catch (error) {
      // SDK errors should never crash the app
      const err = error as Error;
      console.error('Loggplattform SDK: Failed to queue log:', err.message);
    }
  }

  /**
   * Flush queued logs asynchronously
   */
  public async flush(): Promise<void> {
    if (this.logQueue.length === 0 || !this.apiKey) {
      return;
    }

    const logsToSend = this.logQueue.splice(0, this.batchSize);

    // Send logs individually (could be batched in future)
    const promises = logsToSend.map(logEntry => this.sendLog(logEntry));

    try {
      await Promise.allSettled(promises);
    } catch (error) {
      // SDK errors should never crash the app
      const err = error as Error;
      console.error('Loggplattform SDK: Failed to flush logs:', err.message);
    }
  }

  /**
   * Flush queued logs synchronously (blocking)
   */
  public flushSync(): void {
    if (this.logQueue.length === 0 || !this.apiKey) {
      return;
    }

    const logsToSend = [...this.logQueue];
    this.logQueue = [];

    // Send synchronously (blocking)
    for (const logEntry of logsToSend) {
      try {
        this.sendLogSync(logEntry);
      } catch (error) {
        // SDK errors should never crash the app
        const err = error as Error;
        console.error('Loggplattform SDK: Failed to send log:', err.message);
      }
    }
  }

  /**
   * Send a single log entry asynchronously
   */
  private async sendLog(logEntry: LogEntry): Promise<void> {
    if (!this.apiKey) {
      return;
    }

    try {
      await this.httpClient.post(
        `${this.apiUrl}/api/logs`,
        logEntry,
        {
          headers: {
            'X-API-Key': this.apiKey
          }
        }
      );
    } catch (error) {
      // SDK errors should never crash the app
      // Silently fail - logs are best-effort
      if (process.env.LOGGPLATTFORM_DEBUG) {
        const err = error as Error;
        console.error('Loggplattform SDK: Failed to send log:', err.message);
      }
    }
  }

  /**
   * Send a single log entry synchronously (blocking)
   */
  private sendLogSync(logEntry: LogEntry): void {
    if (!this.apiKey) {
      return;
    }

    try {
      const https = require('https');
      const http = require('http');
      const url = require('url');

      const parsedUrl = url.parse(this.apiUrl);
      const client = parsedUrl.protocol === 'https:' ? https : http;

      const postData = JSON.stringify(logEntry);
      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: '/api/logs',
        method: 'POST',
        headers: {
          'X-API-Key': this.apiKey,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 5000
      };

      return new Promise<void>((resolve, reject) => {
        const req = client.request(options, () => {
          resolve();
        });

        req.on('error', (error: Error) => {
          reject(error);
        });

        req.on('timeout', () => {
          req.destroy();
          reject(new Error('Request timeout'));
        });

        req.write(postData);
        req.end();
      });
    } catch (error) {
      // SDK errors should never crash the app
      if (process.env.LOGGPLATTFORM_DEBUG) {
        const err = error as Error;
        console.error('Loggplattform SDK: Failed to send log:', err.message);
      }
    }
  }

  /**
   * Log an info message
   */
  public info(message: string, context?: LogContext): void {
    this.queueLog(this.createLogEntry('info', message, context));
  }

  /**
   * Log a warning message
   */
  public warn(message: string, context?: LogContext): void {
    this.queueLog(this.createLogEntry('warn', message, context));
  }

  /**
   * Log an error message
   */
  public error(message: string, context?: LogContext): void {
    this.queueLog(this.createLogEntry('error', message, context));
  }

  /**
   * Log a debug message
   */
  public debug(message: string, context?: LogContext): void {
    this.queueLog(this.createLogEntry('debug', message, context));
  }

  /**
   * Set correlation ID for all subsequent logs
   */
  public setCorrelationId(correlationId: string): void {
    this.correlationId = correlationId;
  }

  /**
   * Destroy the SDK instance and flush remaining logs
   */
  public destroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    this.flushSync();
  }
}

// Export default instance creator
export default LoggplattformSDK;
