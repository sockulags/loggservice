const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDatabase } = require('../database');
const { readArchivedLogs } = require('../services/archive');

const router = express.Router();

// POST /api/logs - Create a new log entry
router.post('/', async (req, res) => {
  try {
    const { level, message, context, correlation_id } = req.body;
    const service = req.service.name;
    
    // Validate required fields
    if (!level || !message) {
      return res.status(400).json({ error: 'Level and message are required' });
    }
    
    // Validate level
    const validLevels = ['info', 'warn', 'error', 'debug'];
    if (!validLevels.includes(level.toLowerCase())) {
      return res.status(400).json({ error: `Invalid level. Must be one of: ${validLevels.join(', ')}` });
    }
    
    const logId = uuidv4();
    const timestamp = new Date().toISOString();
    const contextJson = context ? JSON.stringify(context) : null;
    
    const db = getDatabase();
    
    db.run(
      `INSERT INTO logs (id, timestamp, level, service, message, context, correlation_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [logId, timestamp, level.toLowerCase(), service, message, contextJson, correlation_id || null],
      function(err) {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Failed to save log' });
        }
        
        res.status(201).json({
          id: logId,
          timestamp,
          level: level.toLowerCase(),
          service,
          message,
          context,
          correlation_id: correlation_id || null
        });
      }
    );
  } catch (error) {
    console.error('Error creating log:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/logs - Query logs with filtering (from DB + archived files)
router.get('/', async (req, res) => {
  try {
    const { 
      service, 
      level, 
      start_time, 
      end_time, 
      correlation_id,
      limit = 100,
      offset = 0 
    } = req.query;
    
    const serviceName = req.service.name;
    const db = getDatabase();
    const conditions = [];
    const params = [];
    
    // Service isolation - only show logs for the authenticated service
    conditions.push('service = ?');
    params.push(serviceName);
    
    if (level) {
      conditions.push('level = ?');
      params.push(level.toLowerCase());
    }
    
    if (start_time) {
      conditions.push('timestamp >= ?');
      params.push(start_time);
    }
    
    if (end_time) {
      conditions.push('timestamp <= ?');
      params.push(end_time);
    }
    
    if (correlation_id) {
      conditions.push('correlation_id = ?');
      params.push(correlation_id);
    }
    
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    
    // Get logs from database
    const dbLogsPromise = new Promise((resolve, reject) => {
      db.all(
        `SELECT id, timestamp, level, service, message, context, correlation_id, created_at
         FROM logs ${whereClause}
         ORDER BY timestamp DESC`,
        params,
        (err, rows) => {
          if (err) {
            reject(err);
            return;
          }
          
          const logs = rows.map(row => {
            let parsedContext = null;

            if (row.context) {
              try {
                parsedContext = JSON.parse(row.context);
              } catch (parseError) {
                console.error('Failed to parse log context JSON for log id:', row.id, parseError);
                parsedContext = null;
              }
            }

            return {
              id: row.id,
              timestamp: row.timestamp,
              level: row.level,
              service: row.service,
              message: row.message,
              context: parsedContext,
              correlation_id: row.correlation_id,
              created_at: row.created_at
            };
          });
          
          resolve(logs);
        }
      );
    });
    
    // Get logs from archived files (if time range overlaps with archives)
    const filters = {
      level: level ? level.toLowerCase() : null,
      correlationId: correlation_id || null
    };
    
    const archivedLogsPromise = readArchivedLogs(serviceName, start_time, end_time, filters);
    
    // Wait for both queries
    const [dbLogs, archivedLogs] = await Promise.all([dbLogsPromise, archivedLogsPromise]);
    
    // Combine and deduplicate logs (by ID)
    const logMap = new Map();
    
    // Add archived logs first (older)
    for (const log of archivedLogs) {
      logMap.set(log.id, log);
    }
    
    // Add database logs (newer, will overwrite if duplicate)
    for (const log of dbLogs) {
      logMap.set(log.id, log);
    }
    
    // Convert to array and sort by timestamp descending
    let allLogs = Array.from(logMap.values());
    allLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    // Apply pagination
    const total = allLogs.length;
    const limitNum = parseInt(limit);
    const offsetNum = parseInt(offset);
    const paginatedLogs = allLogs.slice(offsetNum, offsetNum + limitNum);
    
    res.json({
      logs: paginatedLogs,
      total: total,
      limit: limitNum,
      offset: offsetNum,
      sources: {
        database: dbLogs.length,
        archived: archivedLogs.length
      }
    });
  } catch (error) {
    console.error('Error querying logs:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/logs/:id - Get a specific log entry
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const db = getDatabase();
    
    db.get(
      `SELECT id, timestamp, level, service, message, context, correlation_id, created_at
       FROM logs WHERE id = ? AND service = ?`,
      [id, req.service.name],
      (err, row) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Failed to query log' });
        }
        
        if (!row) {
          return res.status(404).json({ error: 'Log not found' });
        }
        
        res.json({
          id: row.id,
          timestamp: row.timestamp,
          level: row.level,
          service: row.service,
          message: row.message,
          context: row.context ? JSON.parse(row.context) : null,
          correlation_id: row.correlation_id,
          created_at: row.created_at
        });
      }
    );
  } catch (error) {
    console.error('Error querying log:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
