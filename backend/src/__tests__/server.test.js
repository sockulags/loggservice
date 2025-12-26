const request = require('supertest');
const express = require('express');
const { getDatabase } = require('../database');

jest.mock('../database');

describe('Server Health Check', () => {
  let app;

  beforeEach(() => {
    app = express();
    
    // Mock the health check route
    app.get('/health', async (req, res) => {
      try {
        const db = getDatabase();
        
        await new Promise((resolve, reject) => {
          db.get('SELECT 1', [], (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
        
        res.json({ 
          status: 'ok',
          database: 'connected',
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        res.status(503).json({ 
          status: 'error',
          database: 'disconnected',
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('should return healthy status when database is connected', async () => {
    const mockDb = {
      get: jest.fn((query, params, callback) => {
        callback(null, { '1': 1 });
      })
    };
    getDatabase.mockReturnValue(mockDb);

    const response = await request(app)
      .get('/health')
      .expect(200);

    expect(response.body.status).toBe('ok');
    expect(response.body.database).toBe('connected');
    expect(response.body).toHaveProperty('timestamp');
  });

  test('should return unhealthy status when database is disconnected', async () => {
    const mockDb = {
      get: jest.fn((query, params, callback) => {
        callback(new Error('Database connection failed'), null);
      })
    };
    getDatabase.mockReturnValue(mockDb);

    const response = await request(app)
      .get('/health')
      .expect(503);

    expect(response.body.status).toBe('error');
    expect(response.body.database).toBe('disconnected');
    expect(response.body).toHaveProperty('error');
  });
});
