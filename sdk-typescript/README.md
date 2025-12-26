# Loggplattform TypeScript SDK

TypeScript SDK för att skicka loggar till Loggplattform från TypeScript/Node.js-applikationer.

## Installation

```bash
npm install @loggplattform/sdk-typescript
```

Eller från källkod:

```bash
cd sdk-typescript
npm install
npm run build
```

## Användning

### Grundläggande användning

```typescript
import { LoggplattformSDK } from '@loggplattform/sdk-typescript';

const logger = new LoggplattformSDK({
  apiUrl: 'http://localhost:3000',
  apiKey: 'your-api-key-here',
  service: 'my-service',
  environment: 'production'
});

// Skicka loggar
logger.info('Application started');
logger.warn('High memory usage detected');
logger.error('Failed to connect to database');
logger.debug('Processing request', { userId: 123 });
```

### Med miljövariabler

```bash
export LOGGPLATTFORM_API_URL=http://localhost:3000
export LOGGPLATTFORM_API_KEY=your-api-key-here
export LOGGPLATTFORM_SERVICE=my-service
```

```typescript
import { LoggplattformSDK } from '@loggplattform/sdk-typescript';

const logger = new LoggplattformSDK();
logger.info('Using environment variables');
```

### Med kontext

```typescript
logger.info('User logged in', {
  userId: 123,
  email: 'user@example.com',
  ip: '192.168.1.1'
});
```

### Med korrelations-ID

```typescript
import { v4 as uuidv4 } from 'uuid';

const correlationId = uuidv4();
logger.setCorrelationId(correlationId);

logger.info('Request started', { path: '/api/users' });
logger.debug('Database query', { query: 'SELECT * FROM users' });
logger.info('Request completed');
```

### Med TypeScript-typer

```typescript
import { LoggplattformSDK, LogContext } from '@loggplattform/sdk-typescript';

const logger = new LoggplattformSDK({
  apiUrl: 'http://localhost:3000',
  apiKey: 'your-api-key',
  service: 'my-service'
});

interface UserContext extends LogContext {
  userId: number;
  email: string;
  ip: string;
}

const context: UserContext = {
  userId: 123,
  email: 'user@example.com',
  ip: '192.168.1.1'
};

logger.info('User logged in', context);
```

## API

### `new LoggplattformSDK(options)`

Skapar en ny SDK-instans.

**Options:**
- `apiUrl` (string): URL till loggplattform API (default: `http://localhost:3000`)
- `apiKey` (string): API-nyckel för autentisering
- `service` (string): Tjänstnamn (default: `default-service`)
- `environment` (string): Miljö (default: `development`)
- `correlationId` (string): Korrelations-ID för alla loggar
- `flushInterval` (number): Intervall för att skicka loggar i millisekunder (default: 5000)
- `batchSize` (number): Antal loggar att skicka per batch (default: 10)

### Metoder

- `logger.info(message, context?)` - Skicka info-logg
- `logger.warn(message, context?)` - Skicka varning
- `logger.error(message, context?)` - Skicka fel
- `logger.debug(message, context?)` - Skicka debug-logg
- `logger.setCorrelationId(id)` - Sätt korrelations-ID
- `logger.flush()` - Skicka alla väntande loggar asynkront
- `logger.flushSync()` - Skicka alla väntande loggar synkront
- `logger.destroy()` - Stäng SDK och skicka alla väntande loggar

## TypeScript-typer

SDK:en exporterar följande typer:

```typescript
type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LogContext {
  [key: string]: any;
}

interface LogEntry {
  level: LogLevel;
  message: string;
  context?: LogContext;
  correlation_id?: string;
}

interface LoggplattformSDKOptions {
  apiUrl?: string;
  apiKey?: string;
  service?: string;
  environment?: string;
  correlationId?: string;
  flushInterval?: number;
  batchSize?: number;
}
```

## Utveckling

```bash
# Installera beroenden
npm install

# Bygg TypeScript
npm run build

# Utvecklingsläge med watch
npm run dev

# Kör test
npm test
```

## Säkerhet

SDK:ns fel kraschar aldrig applikationen. Om loggning misslyckas fortsätter applikationen att fungera normalt.
