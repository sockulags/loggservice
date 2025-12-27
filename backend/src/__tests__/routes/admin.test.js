const request = require('supertest');
const express = require('express');
const adminRoutes = require('../../routes/admin');
const { archiveOldLogs, cleanupOldArchives } = require('../../services/archive');
const { runArchiveNow } = require('../../services/scheduler');

jest.mock('../../services/archive');
jest.mock('../../services/scheduler');
jest.mock('../../logger', () => ({
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

describe('Admin Routes', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/admin', adminRoutes);
    jest.clearAllMocks();
  });

  describe('POST /api/admin/archive', () => {
    test('should trigger manual archive with default daysOld', async () => {
      archiveOldLogs.mockResolvedValue(50);

      const response = await request(app)
        .post('/api/admin/archive')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        archived: 50,
        message: 'Archived 50 logs'
      });
      expect(archiveOldLogs).toHaveBeenCalledWith(1);
    });

    test('should trigger manual archive with custom daysOld', async () => {
      archiveOldLogs.mockResolvedValue(100);

      const response = await request(app)
        .post('/api/admin/archive')
        .send({ daysOld: 7 });

      expect(response.status).toBe(200);
      expect(response.body.archived).toBe(100);
      expect(archiveOldLogs).toHaveBeenCalledWith(7);
    });

    test('should return 500 on archive error', async () => {
      archiveOldLogs.mockRejectedValue(new Error('Archive failed'));

      const response = await request(app)
        .post('/api/admin/archive')
        .send({});

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to archive logs');
    });
  });

  describe('POST /api/admin/archive-now', () => {
    test('should run archive job immediately', async () => {
      runArchiveNow.mockResolvedValue(25);

      const response = await request(app)
        .post('/api/admin/archive-now')
        .send();

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        archived: 25,
        message: 'Archived 25 logs'
      });
      expect(runArchiveNow).toHaveBeenCalled();
    });

    test('should return 500 on error', async () => {
      runArchiveNow.mockRejectedValue(new Error('Job failed'));

      const response = await request(app)
        .post('/api/admin/archive-now')
        .send();

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to archive logs');
    });
  });

  describe('POST /api/admin/cleanup', () => {
    test('should trigger manual cleanup', async () => {
      cleanupOldArchives.mockResolvedValue(3);

      const response = await request(app)
        .post('/api/admin/cleanup')
        .send();

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        deleted: 3,
        message: 'Deleted 3 old archive directories'
      });
      expect(cleanupOldArchives).toHaveBeenCalled();
    });

    test('should return 500 on cleanup error', async () => {
      cleanupOldArchives.mockRejectedValue(new Error('Cleanup failed'));

      const response = await request(app)
        .post('/api/admin/cleanup')
        .send();

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to cleanup archives');
    });
  });
});
