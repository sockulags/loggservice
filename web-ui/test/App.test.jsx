import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';
import App from '../src/App';

// Mock axios
vi.mock('axios');

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.getItem.mockReturnValue(null);
    // Default mock for empty logs
    axios.get.mockResolvedValue({ data: { logs: [] } });
  });

  it('renders header with title', async () => {
    render(<App />);
    expect(screen.getByText('📦 Loggplattform')).toBeInTheDocument();
  });

  it('renders API key input field', async () => {
    render(<App />);
    expect(screen.getByPlaceholderText('API-nyckel')).toBeInTheDocument();
  });

  it('renders filter controls', async () => {
    render(<App />);
    expect(screen.getByText('Alla nivåer')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Korrelations-ID')).toBeInTheDocument();
    expect(screen.getByText('🔄 Uppdatera')).toBeInTheDocument();
  });

  it('shows loading state initially', async () => {
    render(<App />);
    expect(screen.getByText('Laddar loggar...')).toBeInTheDocument();
  });

  it('shows "no logs" message when API returns empty array', async () => {
    axios.get.mockResolvedValue({ data: { logs: [] } });
    render(<App />);
    
    await waitFor(() => {
      expect(screen.getByText('Inga loggar hittades')).toBeInTheDocument();
    });
  });

  it('displays logs from API', async () => {
    const mockLogs = [
      {
        id: '123',
        level: 'info',
        message: 'Test log message',
        timestamp: '2024-01-15T10:30:00.000Z',
        service: 'test-service',
        correlation_id: null,
        context: null
      }
    ];
    axios.get.mockResolvedValue({ data: { logs: mockLogs } });
    
    render(<App />);
    
    await waitFor(() => {
      expect(screen.getByText('Test log message')).toBeInTheDocument();
    });
    expect(screen.getByText('INFO')).toBeInTheDocument();
  });

  it('displays error level logs with correct styling', async () => {
    const mockLogs = [
      {
        id: '456',
        level: 'error',
        message: 'Error occurred',
        timestamp: '2024-01-15T10:30:00.000Z',
        service: 'test-service',
        correlation_id: null,
        context: null
      }
    ];
    axios.get.mockResolvedValue({ data: { logs: mockLogs } });
    
    render(<App />);
    
    await waitFor(() => {
      expect(screen.getByText('ERROR')).toBeInTheDocument();
    });
    expect(screen.getByText('Error occurred')).toBeInTheDocument();
  });

  it('displays correlation ID when present', async () => {
    const mockLogs = [
      {
        id: '789',
        level: 'info',
        message: 'Log with correlation',
        timestamp: '2024-01-15T10:30:00.000Z',
        service: 'test-service',
        correlation_id: 'corr-123',
        context: null
      }
    ];
    axios.get.mockResolvedValue({ data: { logs: mockLogs } });
    
    render(<App />);
    
    await waitFor(() => {
      expect(screen.getByText('🔗 corr-123')).toBeInTheDocument();
    });
  });

  it('saves API key to localStorage', async () => {
    const user = userEvent.setup();
    render(<App />);
    
    const apiKeyInput = screen.getByPlaceholderText('API-nyckel');
    await user.clear(apiKeyInput);
    await user.type(apiKeyInput, 'my-api-key');
    
    expect(localStorage.setItem).toHaveBeenCalledWith('apiKey', expect.stringContaining('my-api-key'));
  });

  it('loads API key from localStorage on mount', async () => {
    localStorage.getItem.mockReturnValue('saved-key');
    render(<App />);
    
    const apiKeyInput = screen.getByPlaceholderText('API-nyckel');
    expect(apiKeyInput.value).toBe('saved-key');
  });

  it('opens log detail panel when clicking a log', async () => {
    const mockLogs = [
      {
        id: 'detail-log-1',
        level: 'info',
        message: 'Click me',
        timestamp: '2024-01-15T10:30:00.000Z',
        service: 'detail-service',
        correlation_id: null,
        context: { key: 'value' }
      }
    ];
    axios.get.mockResolvedValue({ data: { logs: mockLogs } });
    
    render(<App />);
    
    await waitFor(() => {
      expect(screen.getByText('Click me')).toBeInTheDocument();
    });
    
    fireEvent.click(screen.getByText('Click me'));
    
    expect(screen.getByText('Logg Detaljer')).toBeInTheDocument();
    expect(screen.getByText('detail-service')).toBeInTheDocument();
  });

  it('closes log detail panel when clicking close button', async () => {
    const mockLogs = [
      {
        id: 'close-test',
        level: 'info',
        message: 'Test log',
        timestamp: '2024-01-15T10:30:00.000Z',
        service: 'test-service',
        correlation_id: null,
        context: null
      }
    ];
    axios.get.mockResolvedValue({ data: { logs: mockLogs } });
    
    render(<App />);
    
    await waitFor(() => {
      expect(screen.getByText('Test log')).toBeInTheDocument();
    });
    
    fireEvent.click(screen.getByText('Test log'));
    expect(screen.getByText('Logg Detaljer')).toBeInTheDocument();
    
    fireEvent.click(screen.getByText('✕'));
    expect(screen.queryByText('Logg Detaljer')).not.toBeInTheDocument();
  });

  it('updates level filter when changed', async () => {
    const user = userEvent.setup();
    axios.get.mockResolvedValue({ data: { logs: [] } });
    
    render(<App />);
    
    await waitFor(() => {
      expect(screen.queryByText('Laddar loggar...')).not.toBeInTheDocument();
    });
    
    const levelSelect = screen.getByRole('combobox');
    await user.selectOptions(levelSelect, 'error');
    
    await waitFor(() => {
      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining('level=error'),
        expect.anything()
      );
    });
  });

  it('sends API key in request headers', async () => {
    localStorage.getItem.mockReturnValue('test-api-key');
    axios.get.mockResolvedValue({ data: { logs: [] } });
    
    render(<App />);
    
    await waitFor(() => {
      expect(axios.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: { 'X-API-Key': 'test-api-key' }
        })
      );
    });
  });

  it('shows alert on 401 unauthorized error', async () => {
    const alertMock = vi.spyOn(window, 'alert').mockImplementation(() => {});
    axios.get.mockRejectedValue({ response: { status: 401 } });
    
    render(<App />);
    
    await waitFor(() => {
      expect(alertMock).toHaveBeenCalledWith('Invalid API key');
    });
    
    alertMock.mockRestore();
  });

  it('displays log context in detail view', async () => {
    const mockLogs = [
      {
        id: 'context-log',
        level: 'info',
        message: 'Log with context',
        timestamp: '2024-01-15T10:30:00.000Z',
        service: 'test-service',
        correlation_id: null,
        context: { userId: '123', action: 'login' }
      }
    ];
    axios.get.mockResolvedValue({ data: { logs: mockLogs } });
    
    render(<App />);
    
    await waitFor(() => {
      expect(screen.getByText('Log with context')).toBeInTheDocument();
    });
    
    fireEvent.click(screen.getByText('Log with context'));
    
    // Check that context is displayed as JSON
    expect(screen.getByText(/userId/)).toBeInTheDocument();
    expect(screen.getByText(/123/)).toBeInTheDocument();
  });
});
