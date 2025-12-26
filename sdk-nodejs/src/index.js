const axios = require('axios');
const deasync = require('deasync');

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
    
    // Flush on process exit - use a single handler to prevent race conditions
    const shutdownHandler = () => {
      if (!this.shutdownInProgress) {
        this.shutdownInProgress = true;
        this.flushSync();
      }
    };

    process.on('exit', shutdownHandler);
    process.on('SIGINT', () => {
      shutdownHandler();
      process.exit();
    });
    process.on('SIGTERM', () => {
      shutdownHandler();
      process.exit();
    });
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
    
    const logsToSend = this.logQueue.splice(0, this.batchSize);
    
    // Send logs individually (could be batched in future)
    const promises = logsToSend.map(logEntry => this._sendLog(logEntry));
    
    try {
      await Promise.allSettled(promises);
    } catch (error) {
      // SDK errors should never crash the app
      console.error('Loggplattform SDK: Failed to flush logs:', error.message);
    }
  }
  
  flushSync() {
    if (this.logQueue.length === 0 || !this.apiKey) {
      return;
    }
    
    const logsToSend = [...this.logQueue];
    this.logQueue = [];
    
    // Send synchronously (blocking) - wait for all to complete
    const promises = [];
    for (const logEntry of logsToSend) {
      try {
        const promise = this._sendLogSync(logEntry);
        if (promise) {
          promises.push(promise.catch(error => {
            // SDK errors should never crash the app
            if (process.env.LOGGPLATTFORM_DEBUG) {
              console.error('Loggplattform SDK: Failed to send log:', error.message);
            }
          }));
        }
      } catch (error) {
        // SDK errors should never crash the app
        if (process.env.LOGGPLATTFORM_DEBUG) {
          console.error('Loggplattform SDK: Failed to send log:', error.message);
        }
      }
    }
    
    // Block until all promises complete (with timeout)
    if (promises.length > 0) {
      const startTime = Date.now();
      const timeout = 10000; // 10 second timeout
      let completed = false;
      
      Promise.all(promises).then(() => {
        completed = true;
      }).catch(() => {
        completed = true;
      });
      
      // Synchronously wait for completion using deasync
      deasync.loopWhile(() => {
        const elapsed = Date.now() - startTime;
        if (elapsed > timeout) {
          return false; // Timeout reached
        }
        return !completed; // Continue while not completed
      });
    }
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
  
  _sendLogSync(logEntry) {
    if (!this.apiKey) {
      return Promise.resolve();
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
      
      return new Promise((resolve, reject) => {
        const req = client.request(options, (res) => {
          const statusCode = res.statusCode;

          // Consume response data to free up memory / allow connection reuse
          res.resume();

          if (statusCode >= 200 && statusCode < 300) {
            // Treat 2xx responses as success
            resolve();
          } else {
            // Treat non-2xx responses as failures
            const error = new Error(`Request failed with status code ${statusCode}`);
            error.statusCode = statusCode;
            reject(error);
          }
        });
        
        req.on('error', (error) => {
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
        console.error('Loggplattform SDK: Failed to send log:', error.message);
      }
      return Promise.resolve(); // Return resolved promise on error
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
  
  destroy() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    this.flushSync();
  }
}

module.exports = LoggplattformSDK;
