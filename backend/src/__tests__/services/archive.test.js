// Mock dependencies BEFORE importing the module under test
jest.mock('../../database', () => ({
  getDatabase: jest.fn()
}));

jest.mock('../../logger', () => ({
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

const { getArchiveFilePath } = require('../../services/archive');

describe('Archive Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getArchiveFilePath', () => {
    test('should return correct path for date and service', () => {
      const date = new Date('2024-01-15');
      const service = 'test-service';
      
      const result = getArchiveFilePath(date, service);
      
      expect(result).toContain('2024-01-15');
      expect(result).toContain('test-service.jsonl');
    });

    test('should handle different services', () => {
      const date = new Date('2024-06-01');
      
      const result1 = getArchiveFilePath(date, 'service-a');
      const result2 = getArchiveFilePath(date, 'service-b');
      
      expect(result1).toContain('service-a.jsonl');
      expect(result2).toContain('service-b.jsonl');
    });

    test('should handle different dates', () => {
      const service = 'my-service';
      
      const result1 = getArchiveFilePath(new Date('2024-01-01'), service);
      const result2 = getArchiveFilePath(new Date('2024-12-31'), service);
      
      expect(result1).toContain('2024-01-01');
      expect(result2).toContain('2024-12-31');
    });
  });
});
