const pino = require('pino');

const isProduction = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

const logger = pino({
  level: process.env.LOG_LEVEL || (isTest ? 'silent' : 'info'),
  transport: !isProduction && !isTest
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
  base: {
    service: 'loggplattform-backend',
    version: process.env.npm_package_version || '1.0.0'
  },
  timestamp: pino.stdTimeFunctions.isoTime
});

module.exports = logger;
