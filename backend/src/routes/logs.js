const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDatabase } = require('../database');

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

// GET /api/logs - Query logs with filtering
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
    
    const db = getDatabase();
    const conditions = [];
    const params = [];
    
    // Service isolation - only show logs for the authenticated service
    conditions.push('service = ?');
    params.push(req.service.name);
    
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
    
    // Get total count
    db.get(
      `SELECT COUNT(*) as total FROM logs ${whereClause}`,
      params,
      (err, countResult) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Failed to query logs' });
        }
        
        // Get logs
        params.push(parseInt(limit), parseInt(offset));
        db.all(
          `SELECT id, timestamp, level, service, message, context, correlation_id, created_at
           FROM logs ${whereClause}
           ORDER BY timestamp DESC
           LIMIT ? OFFSET ?`,
          params,
          (err, rows) => {
            if (err) {
              console.error('Database error:', err);
              return res.status(500).json({ error: 'Failed to query logs' });
            }
            
            const logs = rows.map(row => ({
              id: row.id,
              timestamp: row.timestamp,
              level: row.level,
              service: row.service,
              message: row.message,
              context: row.context ? JSON.parse(row.context) : null,
              correlation_id: row.correlation_id,
              created_at: row.created_at
            }));
            
            res.json({
              logs,
              total: countResult.total,
              limit: parseInt(limit),
              offset: parseInt(offset)
            });
          }
        );
      }
    );
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
