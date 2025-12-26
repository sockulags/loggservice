const cron = require('node-cron');
const { archiveOldLogs, cleanupOldArchives } = require('./archive');

const ARCHIVE_SCHEDULE = process.env.ARCHIVE_SCHEDULE || '0 2 * * *'; // Daily at 2 AM
const CLEANUP_SCHEDULE = process.env.CLEANUP_SCHEDULE || '0 3 * * *'; // Daily at 3 AM
const ARCHIVE_DAYS_OLD = parseInt(process.env.ARCHIVE_DAYS_OLD || '1');

let archiveTask = null;
let cleanupTask = null;

/**
 * Start scheduled archive and cleanup jobs
 */
function startScheduler() {
  console.log('Starting archive scheduler...');
  console.log(`Archive schedule: ${ARCHIVE_SCHEDULE} (${ARCHIVE_DAYS_OLD} days old)`);
  console.log(`Cleanup schedule: ${CLEANUP_SCHEDULE}`);
  
  // Schedule daily archive job
  archiveTask = cron.schedule(ARCHIVE_SCHEDULE, async () => {
    try {
      console.log('Running scheduled archive job...');
      await archiveOldLogs(ARCHIVE_DAYS_OLD);
    } catch (error) {
      console.error('Scheduled archive job failed:', error);
    }
  }, {
    scheduled: true,
    timezone: 'UTC'
  });
  
  // Schedule daily cleanup job
  cleanupTask = cron.schedule(CLEANUP_SCHEDULE, async () => {
    try {
      console.log('Running scheduled cleanup job...');
      await cleanupOldArchives();
    } catch (error) {
      console.error('Scheduled cleanup job failed:', error);
    }
  }, {
    scheduled: true,
    timezone: 'UTC'
  });
  
  console.log('Scheduler started successfully');
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
  console.log('Scheduler stopped');
}

/**
 * Run archive job manually (for testing)
 */
async function runArchiveNow() {
  try {
    console.log('Running manual archive job...');
    const count = await archiveOldLogs(ARCHIVE_DAYS_OLD);
    console.log(`Manual archive complete: ${count} logs archived`);
    return count;
  } catch (error) {
    console.error('Manual archive job failed:', error);
    throw error;
  }
}

module.exports = {
  startScheduler,
  stopScheduler,
  runArchiveNow
};
