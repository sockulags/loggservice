# 📦 Loggplattform

Central logginsamling och visning för flera tjänster och språk, via enkla SDK:er.

## 🚀 Snabbstart (< 5 minuter)

### Förutsättningar

- Docker och Docker Compose installerat
- Git (för att klona repot)

### Installation med Docker (Rekommenderat)

1. **Klona repot:**
   ```bash
   git clone <repo-url>
   cd loggplattform
   ```

2. **Starta alla tjänster:**
   ```bash
   docker-compose up -d
   ```
   
   Eller använd start-skriptet:
   ```bash
   ./start.sh
   ```

3. **Öppna webbläsaren:**
   ```
   http://localhost:8080
   ```

4. **Testa med Node.js SDK:**
   ```bash
   cd sdk-nodejs
   npm install
   node test/test.js
   ```

Klart! 🎉

### Lokal utveckling (utan Docker)

Om du vill köra tjänsterna lokalt utan Docker:

1. **Backend:**
   ```bash
   cd backend
   npm install
   npm start
   ```

2. **Web UI:**
   ```bash
   cd web-ui
   npm install
   npm run build  # Bygg först
   npm run dev     # Eller kör dev-server på port 5173
   ```

3. **Öppna webbläsaren:**
   ```
   http://localhost:5173  # Dev-server
   # eller
   http://localhost:3000  # Om backend serverar byggda filer
   ```

## 🧱 Komponenter

### Backend Service
- **Port:** 3000
- **API:** REST API på `/api/logs`
- **Databas:** SQLite (append-only)
- **Autentisering:** API-nyckel via `X-API-Key` header

### Web UI
- **Port:** 8080
- **Funktioner:**
  - Lista loggar
  - Filtrering (nivå, tid, korrelations-ID)
  - Tidslinje
  - Detaljvy per logg

### SDK:er
- **Node.js SDK:** `/sdk-nodejs`
- **Java SDK:** `/sdk-java`

## 📖 Användning

### Skapa en tjänst och få API-nyckel

```bash
curl -X POST http://localhost:3000/api/services \
  -H "Content-Type: application/json" \
  -d '{"name": "my-service"}'
```

Svaret innehåller en `api_key` som du använder för att skicka loggar.

### Skicka loggar via API

```bash
curl -X POST http://localhost:3000/api/logs \
  -H "X-API-Key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "level": "info",
    "message": "Application started",
    "context": {"version": "1.0.0"},
    "correlation_id": "req-123"
  }'
```

### Node.js SDK

```javascript
const LoggplattformSDK = require('./sdk-nodejs/src/index.js');

const logger = new LoggplattformSDK({
  apiUrl: 'http://localhost:3000',
  apiKey: 'your-api-key-here',
  service: 'my-service',
  environment: 'production'
});

logger.info('Application started');
logger.warn('High memory usage');
logger.error('Database connection failed');
logger.debug('Processing request', { userId: 123 });
```

### Java SDK

```java
import com.loggplattform.sdk.LoggplattformSDK;

LoggplattformSDK logger = new LoggplattformSDK.Builder()
    .apiUrl("http://localhost:3000")
    .apiKey("your-api-key-here")
    .service("my-service")
    .environment("production")
    .build();

logger.info("Application started");
logger.warn("High memory usage");
logger.error("Database connection failed");

Map<String, Object> context = new HashMap<>();
context.put("userId", 123);
logger.debug("Processing request", context);
```

## 🔌 API Dokumentation

### POST /api/logs

Skicka en logg.

**Headers:**
- `X-API-Key`: Din API-nyckel (obligatorisk)

**Body:**
```json
{
  "level": "info|warn|error|debug",
  "message": "Loggmeddelande",
  "context": {"key": "value"},
  "correlation_id": "optional-correlation-id"
}
```

### GET /api/logs

Hämta loggar med filtrering.

**Headers:**
- `X-API-Key`: Din API-nyckel (obligatorisk)

**Query Parameters:**
- `level`: Filtrera på nivå (info, warn, error, debug)
- `start_time`: Från tid (ISO 8601)
- `end_time`: Till tid (ISO 8601)
- `correlation_id`: Korrelations-ID
- `limit`: Antal resultat (default: 100)
- `offset`: Offset för paginering (default: 0)

**Exempel:**
```bash
curl "http://localhost:3000/api/logs?level=error&limit=50" \
  -H "X-API-Key: your-api-key-here"
```

### GET /api/logs/:id

Hämta en specifik logg.

**Headers:**
- `X-API-Key`: Din API-nyckel (obligatorisk)

### POST /api/services

Skapa en ny tjänst (för admin/testing).

**Body:**
```json
{
  "name": "service-name"
}
```

## 🗄️ Databas

Loggar lagras i SQLite-databasen (`backend/data/logs.db`). Databasen är append-only och optimerad för läsning med index på:
- `service`
- `level`
- `timestamp`
- `correlation_id`

## 🔐 Säkerhet

- **Service-isolering:** Varje API-nyckel är knuten till en tjänst. Tjänster kan endast se sina egna loggar.
- **Autentisering:** Alla API-anrop kräver en giltig API-nyckel.
- **SDK-säkerhet:** SDK-fel kraschar aldrig applikationen.

## 🐳 Docker

### Bygga och köra lokalt

```bash
# Bygga alla tjänster
docker-compose build

# Starta i bakgrunden
docker-compose up -d

# Visa loggar
docker-compose logs -f

# Stoppa
docker-compose down

# Stoppa och ta bort volymer
docker-compose down -v
```

### Utveckling utan Docker

#### Backend
```bash
cd backend
npm install
npm start
```

#### Web UI
```bash
cd web-ui
npm install
npm run dev
```

## 📁 Projektstruktur

```
loggplattform/
├── backend/           # Backend service (Node.js/Express)
│   ├── src/
│   │   ├── server.js
│   │   ├── database.js
│   │   ├── middleware/
│   │   └── routes/
│   └── Dockerfile
├── sdk-nodejs/        # Node.js SDK
│   ├── src/
│   │   └── index.js
│   └── package.json
├── sdk-java/          # Java SDK
│   ├── src/main/java/
│   └── pom.xml
├── web-ui/            # React Web UI
│   ├── src/
│   └── Dockerfile
├── docker-compose.yml
└── README.md
```

## 🧪 Testa

### Testa Node.js SDK

```bash
cd sdk-nodejs
npm install
node test/test.js
```

### Testa API direkt

```bash
# Skapa en tjänst
curl -X POST http://localhost:3000/api/services \
  -H "Content-Type: application/json" \
  -d '{"name": "test-service"}'

# Skicka en logg (använd API-nyckeln från ovan)
curl -X POST http://localhost:3000/api/logs \
  -H "X-API-Key: test-api-key-123" \
  -H "Content-Type: application/json" \
  -d '{
    "level": "info",
    "message": "Test logg",
    "context": {"test": true}
  }'

# Hämta loggar
curl "http://localhost:3000/api/logs" \
  -H "X-API-Key: test-api-key-123"
```

## 📝 Loggmodell

Varje logg innehåller:
- **id:** Unikt ID (UUID)
- **timestamp:** Tidpunkt (ISO 8601)
- **level:** Nivå (info, warn, error, debug)
- **service:** Tjänstnamn (från API-nyckel)
- **message:** Loggmeddelande
- **context:** Key/value-kontext (JSON)
- **correlation_id:** Korrelations-ID för att spåra relaterade loggar
- **created_at:** Skapad-tidpunkt

## 🎯 Funktioner

✅ Central logginsamling  
✅ Multi-språk SDK:er (Node.js, Java)  
✅ Web UI med filtrering och tidslinje  
✅ Service-isolering  
✅ Korrelations-ID stöd  
✅ Asynkron loggsändning  
✅ Append-only databas  
✅ Docker Compose för lokal körning  
✅ API-nyckel autentisering  

## 📄 Licens

MIT License - se LICENSE filen.

## 🤝 Bidrag

Detta är ett open-source projekt. Bidrag är välkomna!

## 📧 Support

För frågor och support, öppna ett issue i repot.
