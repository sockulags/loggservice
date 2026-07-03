import axios, { AxiosInstance } from 'axios';
import {
  LogLevel,
  LogContext,
  LogEntry,
  LoggplattformSDKOptions
} from './types';

// Track live SDK instances so the optional shutdown handlers can flush them all
const sdkInstances = new Set<LoggplattformSDK>();
let shutdownHandlersRegistered = false;

/**
 * Loggplattform SDK for TypeScript
 *
 * Central logging platform SDK with async sending and automatic metadata.
 * SDK errors never crash the application, and the SDK never installs
 * process-wide signal handlers or calls process.exit() on its own.
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

    // Create HTTP client with default timeout
    this.httpClient = axios.create({
      timeout: 5000,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // Start periodic flush if interval is set. The timer is unref'd so the
    // SDK never keeps the host process alive on its own.
    if (this.flushInterval > 0) {
      this.flushTimer = setInterval(() => this.flush(), this.flushInterval);
      if (typeof this.flushTimer.unref === 'function') {
        this.flushTimer.unref();
      }
    }

    // Register this instance for the optional shutdown handlers
    sdkInstances.add(this);
  }

  /**
   * Optionally register SIGINT/SIGTERM handlers that flush all SDK instances
   * before the process terminates.
   *
   * This is opt-in: the SDK never installs process-wide handlers on its own,
   * and the handlers never call process.exit(). After flushing (max 2 seconds),
   * the signal is re-raised so the default termination behavior is preserved.
   */
  public static registerShutdownHandlers(): void {
    if (shutdownHandlersRegistered) {
      return;
    }
    shutdownHandlersRegistered = true;

    const flushAll = async (): Promise<void> => {
      const flushPromises = Array.from(sdkInstances).map(instance =>
        instance.destroy().catch((error: unknown) => {
          if (process.env.LOGGPLATTFORM_DEBUG) {
            const err = error as Error;
            console.error('Loggplattform SDK: Error flushing logs on shutdown:', err.message);
          }
        })
      );

      // Wait up to 2 seconds for the flush to complete
      await Promise.race([
        Promise.all(flushPromises),
        new Promise<void>(resolve => setTimeout(resolve, 2000))
      ]);
    };

    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.once(signal, () => {
        void flushAll().then(() => {
          // Re-raise the signal so the default handler terminates the process.
          // The SDK itself never calls process.exit().
          process.kill(process.pid, signal);
        });
      });
    }
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
   * Flush queued logs asynchronously.
   *
   * Tries the batch endpoint first and falls back to individual sends
   * if the batch request fails.
   */
  public async flush(): Promise<void> {
    if (this.logQueue.length === 0 || !this.apiKey) {
      return;
    }

    const logsToSend = this.logQueue.splice(0, this.batchSize);

    try {
      // Try batch endpoint first
      await this.sendBatchLogs(logsToSend);
    } catch (batchError) {
      // Fallback to individual sends if batch fails
      if (process.env.LOGGPLATTFORM_DEBUG || process.env.NODE_ENV === 'development') {
        const err = batchError as Error;
        console.warn('Loggplattform SDK: Batch send failed, falling back to individual sends:', err.message);
      }
      const promises = logsToSend.map(logEntry => this.sendLog(logEntry));
      await Promise.allSettled(promises);
    }
  }

  /**
   * Non-blocking flush trigger (kept for backwards compatibility).
   *
   * This method triggers an asynchronous fire-and-forget flush and returns
   * immediately. For guaranteed delivery, call `await flush()` instead.
   */
  public flushSync(): void {
    this.flush().catch((error: unknown) => {
      if (process.env.LOGGPLATTFORM_DEBUG) {
        const err = error as Error;
        console.error('Loggplattform SDK: Error in flushSync:', err.message);
      }
    });
  }

  /**
   * Send a batch of log entries to the batch endpoint
   */
  private async sendBatchLogs(logEntries: LogEntry[]): Promise<void> {
    if (!this.apiKey || logEntries.length === 0) {
      return;
    }

    try {
      await this.httpClient.post(
        `${this.apiUrl}/api/logs/batch`,
        { logs: logEntries },
        {
          headers: {
            'X-API-Key': this.apiKey
          },
          timeout: 10000 // 10 second timeout for batches
        }
      );
    } catch (error) {
      // SDK errors should never crash the app
      if (process.env.LOGGPLATTFORM_DEBUG) {
        const err = error as Error;
        console.error('Loggplattform SDK: Failed to send batch logs:', err.message);
      }
      throw error; // Re-throw to trigger fallback
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
   * Destroy the SDK instance: stop the flush timer and flush pending logs.
   *
   * Await this method during application shutdown to ensure all queued
   * logs are delivered:
   *
   *   await sdk.destroy();
   *
   * @returns A promise that resolves when all queued logs are flushed
   */
  public async destroy(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
    // Remove this instance from the set
    sdkInstances.delete(this);
    // Flush until the queue is drained
    while (this.apiKey && this.logQueue.length > 0) {
      await this.flush();
    }
  }
}

// Export default instance creator
export default LoggplattformSDK;
