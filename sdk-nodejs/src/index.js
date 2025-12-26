const axios = require('axios');

// Singleton pattern for process event handlers to prevent duplicate handlers
let processHandlersRegistered = false;
const sdkInstances = new Set();

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
    
    // Register this instance
    sdkInstances.add(this);
    
    // Register process handlers only once (singleton pattern)
    if (!processHandlersRegistered) {
      processHandlersRegistered = true;
      
      // For SIGINT/SIGTERM, flush all instances then explicitly exit
      const signalHandler = async () => {
        // Flush all SDK instances
        const flushPromises = Array.from(sdkInstances).map(instance => {
          // Skip instances that are already shutting down
          if (instance.shutdownInProgress) {
            return Promise.resolve();
          }

          instance.shutdownInProgress = true;
          if (instance.flushTimer) {
            clearInterval(instance.flushTimer);
            instance.flushTimer = undefined;
          }
          return instance.flush().catch(err => {
            if (process.env.LOGGPLATTFORM_DEBUG) {
              console.error('Loggplattform SDK: Error flushing logs on shutdown:', err.message);
            }
          });
        });
        
        // Wait up to 2 seconds for flush to complete
        await Promise.race([
          Promise.all(flushPromises),
          new Promise(resolve => setTimeout(resolve, 2000))
        ]);
        
        // Explicitly exit after flush operations complete
        process.exit(0);
      };

      process.on('SIGINT', signalHandler);
      process.on('SIGTERM', signalHandler);
    }
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
      // Log for operational visibility if debug is enabled or NODE_ENV is development
      if (process.env.LOGGPLATTFORM_DEBUG || process.env.NODE_ENV === 'development') {
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
   * Non-blocking flush trigger (kept for backwards compatibility).
   *
   * BREAKING CHANGE: This method used to flush logs synchronously, but it is now
   * implemented as an asynchronous fire-and-forget call and returns immediately.
   * This is a breaking change in behavior for the name `flushSync()`.
   *
   * For true synchronous/blocking behavior, call `await flush()` instead.
   */
  flushSync() {
    // Trigger an asynchronous flush without waiting for completion
    // (fire-and-forget, non-blocking)
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
  
  /**
   * Destroy the SDK instance and flush pending logs.
   * 
   * BREAKING CHANGE: This method is now async and returns a Promise.
   * Callers must await this method to ensure logs are flushed:
   * 
   *   await sdk.destroy();
   * 
   * @returns {Promise<void>} A promise that resolves when logs are flushed
   */
  async destroy() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
    // Remove this instance from the set
    sdkInstances.delete(this);
    await this.flush();
  }
}

module.exports = LoggplattformSDK;
