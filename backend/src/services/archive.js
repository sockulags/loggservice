const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { getDatabase } = require('../database');

const ARCHIVE_DIR = process.env.ARCHIVE_DIR || path.join(__dirname, '../../data/archives');
const ARCHIVE_RETENTION_DAYS = parseInt(process.env.ARCHIVE_RETENTION_DAYS || '30');
const ARCHIVE_BATCH_SIZE = parseInt(process.env.ARCHIVE_BATCH_SIZE || '10000');

// Ensure archive directory exists
async function ensureArchiveDir() {
  if (!fsSync.existsSync(ARCHIVE_DIR)) {
    await fs.mkdir(ARCHIVE_DIR, { recursive: true });
  }
}

/**
 * Get archive file path for a specific date and service
 */
function getArchiveFilePath(date, service) {
  const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
  const serviceDir = path.join(ARCHIVE_DIR, dateStr);
  return path.join(serviceDir, `${service}.jsonl`);
}

/**
 * Archive logs older than specified days
 * Moves logs from database to JSONL files (one file per service per day)
 */
async function archiveOldLogs(daysOld = 1) {
  try {
    await ensureArchiveDir();
    
    const db = getDatabase();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    cutoffDate.setHours(0, 0, 0, 0); // Start of day
    
    const cutoffDateStr = cutoffDate.toISOString();
    
    console.log(`Archiving logs older than ${cutoffDateStr}...`);
    
    // Get all services
    const services = await new Promise((resolve, reject) => {
      db.all('SELECT DISTINCT name FROM services', [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows.map(r => r.name));
      });
    });
    
    let totalArchived = 0;
    
    for (const service of services) {
      // Get logs to archive for this service
      const logsToArchive = await new Promise((resolve, reject) => {
        db.all(
          `SELECT id, timestamp, level, service, message, context, correlation_id, created_at
           FROM logs
           WHERE service = ? AND timestamp < ?
           ORDER BY timestamp ASC
           LIMIT ?`,
          [service, cutoffDateStr, ARCHIVE_BATCH_SIZE],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
          }
        );
      });
      
      if (logsToArchive.length === 0) {
        continue;
      }
      
      // Group logs by date
      const logsByDate = {};
      for (const log of logsToArchive) {
        const logDate = new Date(log.timestamp);
        const dateStr = logDate.toISOString().split('T')[0];
        
        if (!logsByDate[dateStr]) {
          logsByDate[dateStr] = [];
        }
        
        logsByDate[dateStr].push({
          id: log.id,
          timestamp: log.timestamp,
          level: log.level,
          service: log.service,
          message: log.message,
          context: log.context ? JSON.parse(log.context) : null,
          correlation_id: log.correlation_id,
          created_at: log.created_at
        });
      }
      
      // Write to archive files (one file per day per service)
      for (const [dateStr, logs] of Object.entries(logsByDate)) {
        const archivePath = getArchiveFilePath(new Date(dateStr), service);
        const archiveDir = path.dirname(archivePath);
        
        // Ensure directory exists
        if (!fsSync.existsSync(archiveDir)) {
          await fs.mkdir(archiveDir, { recursive: true });
        }
        
        // Append logs to file (JSONL format - one JSON object per line)
        const lines = logs.map(log => JSON.stringify(log)).join('\n') + '\n';
        await fs.appendFile(archivePath, lines, 'utf8');
        
        // Delete archived logs from database
        const logIds = logs.map(log => log.id);

        await new Promise((resolve, reject) => {
          db.serialize(() => {
            db.run('BEGIN TRANSACTION');
            const stmt = db.prepare('DELETE FROM logs WHERE id = ?');

            for (const id of logIds) {
              stmt.run(id);
            }

            stmt.finalize(err => {
              if (err) {
                db.run('ROLLBACK', () => reject(err));
              } else {
                db.run('COMMIT', commitErr => {
                  if (commitErr) {
                    reject(commitErr);
                  } else {
                    resolve();
                  }
                });
              }
            });
          });
        });
        
        totalArchived += logs.length;
        console.log(`Archived ${logs.length} logs for ${service} on ${dateStr}`);
      }
    }
    
    console.log(`Archive complete: ${totalArchived} logs archived`);
    return totalArchived;
  } catch (error) {
    console.error('Archive error:', error);
    throw error;
  }
}

/**
 * Read archived logs from files for a specific date range and service
 */
async function readArchivedLogs(service, startTime, endTime, filters = {}) {
  try {
    await ensureArchiveDir();
    
    const startDate = startTime ? new Date(startTime) : new Date(0);
    const endDate = endTime ? new Date(endTime) : new Date();
    
    // Get all dates in range
    const dates = [];
    const currentDate = new Date(startDate);
    currentDate.setHours(0, 0, 0, 0);
    
    while (currentDate <= endDate) {
      dates.push(new Date(currentDate));
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    const logs = [];
    
    for (const date of dates) {
      const archivePath = getArchiveFilePath(date, service);
      
      if (!fsSync.existsSync(archivePath)) {
        continue;
      }
      
      // Read file line by line (JSONL format)
      const content = await fs.readFile(archivePath, 'utf8');
      const lines = content.trim().split('\n').filter(line => line.trim());
      
      for (const line of lines) {
        try {
          const log = JSON.parse(line);
          
          // Apply filters
          const logTime = new Date(log.timestamp);
          
          if (logTime < startDate || logTime > endDate) {
            continue;
          }
          
          if (filters.level && log.level !== filters.level) {
            continue;
          }
          
          if (filters.correlationId && log.correlation_id !== filters.correlationId) {
            continue;
          }
          
          logs.push(log);
        } catch (parseError) {
          console.error(`Failed to parse log line: ${parseError.message}`);
        }
      }
    }
    
    // Sort by timestamp descending
    logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    return logs;
  } catch (error) {
    console.error('Error reading archived logs:', error);
    return [];
  }
}

/**
 * Clean up old archive files (older than retention period)
 */
async function cleanupOldArchives() {
  try {
    await ensureArchiveDir();
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - ARCHIVE_RETENTION_DAYS);
    
    const entries = await fs.readdir(ARCHIVE_DIR, { withFileTypes: true });
    let deletedCount = 0;
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const dirDate = new Date(entry.name);
        if (dirDate < cutoffDate) {
          const dirPath = path.join(ARCHIVE_DIR, entry.name);
          await fs.rm(dirPath, { recursive: true, force: true });
          deletedCount++;
          console.log(`Deleted old archive directory: ${entry.name}`);
        }
      }
    }
    
    if (deletedCount > 0) {
      console.log(`Cleanup complete: ${deletedCount} old archive directories deleted`);
    }
    
    return deletedCount;
  } catch (error) {
    console.error('Cleanup error:', error);
    throw error;
  }
}

module.exports = {
  archiveOldLogs,
  readArchivedLogs,
  cleanupOldArchives,
  getArchiveFilePath
};
