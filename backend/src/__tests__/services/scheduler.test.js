// Mock dependencies BEFORE requiring scheduler
jest.mock('node-cron', () => ({
  schedule: jest.fn(() => ({ stop: jest.fn() }))
}));

jest.mock('../../services/archive', () => ({
  archiveOldLogs: jest.fn(),
  cleanupOldArchives: jest.fn()
}));

jest.mock('../../logger', () => ({
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

const cron = require('node-cron');
const { archiveOldLogs, cleanupOldArchives } = require('../../services/archive');
const { startScheduler, stopScheduler, runArchiveNow } = require('../../services/scheduler');

describe('Scheduler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset cron mock to return new task with stop function
    cron.schedule.mockReturnValue({ stop: jest.fn() });
  });

  describe('startScheduler', () => {
    test('should schedule archive and cleanup jobs', () => {
      startScheduler();

      expect(cron.schedule).toHaveBeenCalledTimes(2);
      // Archive task
      expect(cron.schedule).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Function),
        expect.objectContaining({ scheduled: true, timezone: 'UTC' })
      );
    });

    test('should use default schedule when env vars not set', () => {
      startScheduler();

      // Default schedules
      expect(cron.schedule.mock.calls[0][0]).toBe('0 2 * * *'); // Archive at 2 AM
      expect(cron.schedule.mock.calls[1][0]).toBe('0 3 * * *'); // Cleanup at 3 AM
    });
  });

  describe('stopScheduler', () => {
    test('should stop scheduled tasks when called', () => {
      const mockStop1 = jest.fn();
      const mockStop2 = jest.fn();
      cron.schedule
        .mockReturnValueOnce({ stop: mockStop1 })
        .mockReturnValueOnce({ stop: mockStop2 });

      startScheduler();
      stopScheduler();

      expect(mockStop1).toHaveBeenCalled();
      expect(mockStop2).toHaveBeenCalled();
    });
  });

  describe('runArchiveNow', () => {
    test('should run archive immediately', async () => {
      archiveOldLogs.mockResolvedValue(42);
      
      const result = await runArchiveNow();

      expect(result).toBe(42);
      expect(archiveOldLogs).toHaveBeenCalledWith(1); // Default days old
    });

    test('should throw error if archive fails', async () => {
      archiveOldLogs.mockRejectedValue(new Error('Archive failed'));
      
      await expect(runArchiveNow()).rejects.toThrow('Archive failed');
    });
  });

  describe('scheduled job callbacks', () => {
    test('archive job callback should call archiveOldLogs', async () => {
      archiveOldLogs.mockResolvedValue(10);
      startScheduler();

      // Get the archive callback (first call to cron.schedule)
      const archiveCallback = cron.schedule.mock.calls[0][1];
      await archiveCallback();

      expect(archiveOldLogs).toHaveBeenCalled();
    });

    test('archive job callback should handle errors gracefully', async () => {
      archiveOldLogs.mockRejectedValue(new Error('Archive error'));
      startScheduler();

      // Get the archive callback
      const archiveCallback = cron.schedule.mock.calls[0][1];
      
      // Should not throw - errors are caught internally
      await archiveCallback();
      expect(archiveOldLogs).toHaveBeenCalled();
    });

    test('cleanup job callback should call cleanupOldArchives', async () => {
      cleanupOldArchives.mockResolvedValue(5);
      startScheduler();

      // Get the cleanup callback (second call to cron.schedule)
      const cleanupCallback = cron.schedule.mock.calls[1][1];
      await cleanupCallback();

      expect(cleanupOldArchives).toHaveBeenCalled();
    });

    test('cleanup job callback should handle errors gracefully', async () => {
      cleanupOldArchives.mockRejectedValue(new Error('Cleanup error'));
      startScheduler();

      // Get the cleanup callback
      const cleanupCallback = cron.schedule.mock.calls[1][1];
      
      // Should not throw - errors are caught internally
      await cleanupCallback();
      expect(cleanupOldArchives).toHaveBeenCalled();
    });
  });
});
