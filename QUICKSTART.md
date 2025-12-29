# ⚡ Snabbstart Guide

> 📖 **För komplett guide, se [SETUP.md](SETUP.md)**

## Med Docker (Rekommenderat)

```bash
# 1. Konfigurera miljövariabler
cp .env.example .env
echo "ADMIN_API_KEY=$(openssl rand -hex 32)" >> .env

# 2. Starta alla tjänster
export $(grep -v '^#' .env | xargs)
docker-compose up -d

# 3. Öppna webbläsaren
open http://localhost:8080

# 4. Testa SDK
cd sdk-nodejs
npm install
node test/test.js
```

## Skapa en tjänst och få API-nyckel

```bash
curl -X POST http://localhost:3001/api/services \
  -H "Content-Type: application/json" \
  -d '{"name": "my-service"}'
```

## Skicka en logg

```bash
curl -X POST http://localhost:3001/api/logs \
  -H "X-API-Key: din-api-nyckel-från-ovan" \
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
  apiUrl: 'http://localhost:3001',
  apiKey: 'your-api-key',
  service: 'my-service'
});

logger.info('App started');
```

### TypeScript
```typescript
import { LoggplattformSDK } from './sdk-typescript/src/index';

const logger = new LoggplattformSDK({
  apiUrl: 'http://localhost:3001',
  apiKey: 'your-api-key',
  service: 'my-service'
});

logger.info('App started');
```

### Java
```java
LoggplattformSDK logger = new LoggplattformSDK.Builder()
    .apiUrl("http://localhost:3001")
    .apiKey("your-api-key")
    .service("my-service")
    .build();

logger.info("App started");
```

## Stoppa tjänsterna

```bash
docker-compose down
```
