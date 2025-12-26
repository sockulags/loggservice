const express = require('express');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { getDatabase } = require('../database');

const router = express.Router();

// POST /api/services - Create a new service (for admin/testing)
router.post('/', async (req, res) => {
  try {
    const { name } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Service name is required' });
    }
    
    const serviceId = uuidv4();
    const apiKey = `sk_${crypto.randomBytes(32).toString('hex')}`;
    
    const db = getDatabase();
    
    db.run(
      `INSERT INTO services (id, name, api_key) VALUES (?, ?, ?)`,
      [serviceId, name, apiKey],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint')) {
            return res.status(409).json({ error: 'Service name already exists' });
          }
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Failed to create service' });
        }
        
        res.status(201).json({
          id: serviceId,
          name,
          api_key: apiKey
        });
      }
    );
  } catch (error) {
    console.error('Error creating service:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/services - List all services (for admin/testing)
router.get('/', async (req, res) => {
  try {
    const db = getDatabase();
    
    db.all(
      `SELECT id, name, created_at FROM services ORDER BY created_at DESC`,
      [],
      (err, rows) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Failed to query services' });
        }
        
        res.json({ services: rows });
      }
    );
  } catch (error) {
    console.error('Error querying services:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
