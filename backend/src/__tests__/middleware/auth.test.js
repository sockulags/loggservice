const { authenticate } = require('../../middleware/auth');
const { getDatabase } = require('../../database');

jest.mock('../../database');

describe('Authentication Middleware', () => {
  let req, res, next;

  beforeEach(() => {
    req = {
      headers: {},
      service: null
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    next = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('should reject request without API key', async () => {
    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Missing API key' });
    expect(next).not.toHaveBeenCalled();
  });

  test('should reject request with invalid API key', async () => {
    req.headers['x-api-key'] = 'invalid-key';
    
    const mockDb = {
      get: jest.fn((query, params, callback) => {
        callback(null, null); // No service found
      })
    };
    getDatabase.mockReturnValue(mockDb);

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid API key' });
    expect(next).not.toHaveBeenCalled();
  });

  test('should accept request with valid API key', async () => {
    req.headers['x-api-key'] = 'valid-key';
    
    const mockService = { id: 'test-id', name: 'test-service' };
    const mockDb = {
      get: jest.fn((query, params, callback) => {
        callback(null, mockService);
      })
    };
    getDatabase.mockReturnValue(mockDb);

    await authenticate(req, res, next);

    expect(req.service).toEqual(mockService);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('should handle database errors', async () => {
    req.headers['x-api-key'] = 'valid-key';
    
    const mockDb = {
      get: jest.fn((query, params, callback) => {
        callback(new Error('Database error'), null);
      })
    };
    getDatabase.mockReturnValue(mockDb);

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Database error' });
    expect(next).not.toHaveBeenCalled();
  });
});
