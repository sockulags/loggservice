const axios = require('axios');

class LoggplattformSDK {
  constructor(options = {}) {
    this.apiUrl = options.apiUrl || process.env.LOGGPLATTFORM_API_URL || 'http://localhost:3000';
    this.apiKey = options.apiKey || process.env.LOGGPLATTFORM_API_KEY;
    this.service = options.service || process.env.LOGGPLATTFORM_SERVICE || 'default-service';
    this.environment = options.environment || process.env.NODE_ENV || 'development';
    this.correlationId = options.correlationId;
    
    if (!this.apiKey) {
      console.warn('Loggplattform SDK: No API key provided. Logs will not be sent.');
    }
    
    // Queue for async log sending
    this.logQueue = [];
    this.flushInterval = options.flushInterval || 5000; // 5 seconds
    this.batchSize = options.batchSize || 10;
    this.shutdownInProgress = false;
    
    // Start periodic flush
    if (this.flushInterval > 0) {
      this.flushTimer = setInterval(() => this.flush(), this.flushInterval);
    }
    
    // Flush on process exit - use async handler
    const shutdownHandler = async () => {
      if (!this.shutdownInProgress) {
        this.shutdownInProgress = true;
        if (this.flushTimer) {
          clearInterval(this.flushTimer);
          this.flushTimer = undefined;
        }
        // Attempt to flush logs, but don't block shutdown
        await this.flush().catch(err => {
          if (process.env.LOGGPLATTFORM_DEBUG) {
            console.error('Loggplattform SDK: Error flushing logs on shutdown:', err.message);
          }
        });
      }
    };

    // Use beforeExit for async cleanup (allows async operations)
    process.on('beforeExit', async () => {
      await shutdownHandler();
    });

    // For SIGINT/SIGTERM, try to flush but don't block indefinitely
    const signalHandler = async () => {
      await shutdownHandler();
      // Give a short time for logs to send, then exit
      setTimeout(() => {
        process.exit(0);
      }, 2000); // 2 second grace period
    };

    process.on('SIGINT', signalHandler);
    process.on('SIGTERM', signalHandler);
  }
  
  _createLogEntry(level, message, context = {}) {
    return {
      level,
      message,
      context: {
        ...context,
        environment: this.environment,
        service: this.service
      },
      correlation_id: this.correlationId || context.correlation_id
    };
  }
  
  _queueLog(logEntry) {
    try {
      this.logQueue.push(logEntry);
      
      // Auto-flush if queue reaches batch size
      if (this.logQueue.length >= this.batchSize) {
        this.flush();
      }
    } catch (error) {
      // SDK errors should never crash the app
      console.error('Loggplattform SDK: Failed to queue log:', error.message);
    }
  }
  
  async flush() {
    if (this.logQueue.length === 0 || !this.apiKey) {
      return;
    }
    
    // Use batch endpoint if available, otherwise send individually
    const logsToSend = this.logQueue.splice(0, this.batchSize);
    
    try {
      // Try batch endpoint first
      await this._sendBatchLogs(logsToSend);
    } catch (batchError) {
      // Fallback to individual sends if batch fails
      if (process.env.LOGGPLATTFORM_DEBUG) {
        console.warn('Loggplattform SDK: Batch send failed, falling back to individual sends:', batchError.message);
      }
      const promises = logsToSend.map(logEntry => this._sendLog(logEntry));
      await Promise.allSettled(promises);
    }
  }
  
  async _sendBatchLogs(logEntries) {
    if (!this.apiKey || logEntries.length === 0) {
      return;
    }
    
    try {
      await axios.post(
        `${this.apiUrl}/api/logs/batch`,
        { logs: logEntries },
        {
          headers: {
            'X-API-Key': this.apiKey,
            'Content-Type': 'application/json'
          },
          timeout: 10000 // 10 second timeout for batches
        }
      );
    } catch (error) {
      // SDK errors should never crash the app
      if (process.env.LOGGPLATTFORM_DEBUG) {
        console.error('Loggplattform SDK: Failed to send batch logs:', error.message);
      }
      throw error; // Re-throw to trigger fallback
    }
  }
  
  /**
   * Flush logs synchronously (for backwards compatibility)
   * Note: This is now async internally but returns immediately
   * For true synchronous behavior, use flush() and await it
   */
  flushSync() {
    // For backwards compatibility, just call async flush
    // but don't wait for it (non-blocking)
    this.flush().catch(err => {
      if (process.env.LOGGPLATTFORM_DEBUG) {
        console.error('Loggplattform SDK: Error in flushSync:', err.message);
      }
    });
  }
  
  async _sendLog(logEntry) {
    if (!this.apiKey) {
      return;
    }
    
    try {
      await axios.post(
        `${this.apiUrl}/api/logs`,
        logEntry,
        {
          headers: {
            'X-API-Key': this.apiKey,
            'Content-Type': 'application/json'
          },
          timeout: 5000
        }
      );
    } catch (error) {
      // SDK errors should never crash the app
      // Silently fail - logs are best-effort
      if (process.env.LOGGPLATTFORM_DEBUG) {
        console.error('Loggplattform SDK: Failed to send log:', error.message);
      }
    }
  }
  
  
  info(message, context = {}) {
    this._queueLog(this._createLogEntry('info', message, context));
  }
  
  warn(message, context = {}) {
    this._queueLog(this._createLogEntry('warn', message, context));
  }
  
  error(message, context = {}) {
    this._queueLog(this._createLogEntry('error', message, context));
  }
  
  debug(message, context = {}) {
    this._queueLog(this._createLogEntry('debug', message, context));
  }
  
  setCorrelationId(correlationId) {
    this.correlationId = correlationId;
  }
  
  async destroy() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
    await this.flush();
  }
}

module.exports = LoggplattformSDK;
