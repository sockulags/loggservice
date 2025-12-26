# ⚡ Snabbstart Guide

## Med Docker (Rekommenderat)

```bash
# 1. Starta alla tjänster
docker-compose up -d

# 2. Öppna webbläsaren
open http://localhost:8080

# 3. Testa SDK
cd sdk-nodejs
npm install
node test/test.js
```

## Skapa en tjänst och få API-nyckel

```bash
curl -X POST http://localhost:3000/api/services \
  -H "Content-Type: application/json" \
  -d '{"name": "my-service"}'
```

## Skicka en logg

```bash
curl -X POST http://localhost:3000/api/logs \
  -H "X-API-Key: test-api-key-123" \
  -H "Content-Type: application/json" \
  -d '{
    "level": "info",
    "message": "Hello from Loggplattform!",
    "context": {"test": true}
  }'
```

## Använd SDK i din applikation

### Node.js
```javascript
const LoggplattformSDK = require('./sdk-nodejs/src/index.js');

const logger = new LoggplattformSDK({
  apiUrl: 'http://localhost:3000',
  apiKey: 'your-api-key',
  service: 'my-service'
});

logger.info('App started');
```

### TypeScript
```typescript
import { LoggplattformSDK } from './sdk-typescript/src/index';

const logger = new LoggplattformSDK({
  apiUrl: 'http://localhost:3000',
  apiKey: 'your-api-key',
  service: 'my-service'
});

logger.info('App started');
```

### Java
```java
LoggplattformSDK logger = new LoggplattformSDK.Builder()
    .apiUrl("http://localhost:3000")
    .apiKey("your-api-key")
    .service("my-service")
    .build();

logger.info("App started");
```

## Stoppa tjänsterna

```bash
docker-compose down
```
