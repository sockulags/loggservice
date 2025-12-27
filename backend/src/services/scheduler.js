const cron = require('node-cron');
const { archiveOldLogs, cleanupOldArchives } = require('./archive');
const logger = require('../logger');

const ARCHIVE_SCHEDULE = process.env.ARCHIVE_SCHEDULE || '0 2 * * *'; // Daily at 2 AM
const CLEANUP_SCHEDULE = process.env.CLEANUP_SCHEDULE || '0 3 * * *'; // Daily at 3 AM
const ARCHIVE_DAYS_OLD = parseInt(process.env.ARCHIVE_DAYS_OLD || '1');

let archiveTask = null;
let cleanupTask = null;

/**
 * Start scheduled archive and cleanup jobs
 */
function startScheduler() {
  logger.info({
    archiveSchedule: ARCHIVE_SCHEDULE,
    cleanupSchedule: CLEANUP_SCHEDULE,
    archiveDaysOld: ARCHIVE_DAYS_OLD
  }, 'Starting archive scheduler');
  
  // Schedule daily archive job
  archiveTask = cron.schedule(ARCHIVE_SCHEDULE, async () => {
    try {
      logger.info('Running scheduled archive job');
      await archiveOldLogs(ARCHIVE_DAYS_OLD);
    } catch (error) {
      logger.error({ err: error }, 'Scheduled archive job failed');
    }
  }, {
    scheduled: true,
    timezone: 'UTC'
  });
  
  // Schedule daily cleanup job
  cleanupTask = cron.schedule(CLEANUP_SCHEDULE, async () => {
    try {
      logger.info('Running scheduled cleanup job');
      await cleanupOldArchives();
    } catch (error) {
      logger.error({ err: error }, 'Scheduled cleanup job failed');
    }
  }, {
    scheduled: true,
    timezone: 'UTC'
  });
  
  logger.info('Scheduler started successfully');
}

/**
 * Stop scheduled jobs
 */
function stopScheduler() {
  if (archiveTask) {
    archiveTask.stop();
    archiveTask = null;
  }
  if (cleanupTask) {
    cleanupTask.stop();
    cleanupTask = null;
  }
  logger.info('Scheduler stopped');
}

/**
 * Run archive job manually (for testing)
 */
async function runArchiveNow() {
  try {
    logger.info('Running manual archive job');
    const count = await archiveOldLogs(ARCHIVE_DAYS_OLD);
    logger.info({ count }, 'Manual archive complete');
    return count;
  } catch (error) {
    logger.error({ err: error }, 'Manual archive job failed');
    throw error;
  }
}

module.exports = {
  startScheduler,
  stopScheduler,
  runArchiveNow
};
