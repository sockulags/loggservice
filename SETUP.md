# 🚀 Loggplattform - Komplett Installationsguide

Denna guide visar exakt hur du installerar och kör Loggplattform efter att ha klonat repot.

## 📋 Förutsättningar

Innan du börjar, se till att du har:

- **Docker** och **Docker Compose** installerat
- **Git** (för att klona repot)
- En terminal/kommandotolk

### Kontrollera installationer

```bash
# Kontrollera Docker
docker --version
docker-compose --version

# Kontrollera Git
git --version
```

---

## 🔧 Steg-för-steg Installation

### 1. Klona repot

```bash
git clone <repo-url>
cd loggplattform
```

### 2. Skapa konfigurationsfil

Kopiera exempelfilen och redigera den:

```bash
cp .env.example .env
```

**Redigera `.env`-filen och ställ in minst dessa värden:**

```bash
# OBLIGATORISK - Generera en säker nyckel:
ADMIN_API_KEY=$(openssl rand -hex 32)

# Portkonfiguration (undvik konflikter med port 3000)
BACKEND_PORT=3001
WEBUI_PORT=8080
```

**Snabbkommando för att generera och spara ADMIN_API_KEY:**

```bash
echo "ADMIN_API_KEY=$(openssl rand -hex 32)" >> .env
echo "BACKEND_PORT=3001" >> .env
echo "WEBUI_PORT=8080" >> .env
```

### 3. Välj databas

#### Alternativ A: SQLite (Standard - enklast)

Ingen extra konfiguration behövs. Bara fortsätt till steg 4.

#### Alternativ B: PostgreSQL

Lägg till dessa rader i din `.env`-fil:

```bash
# PostgreSQL-konfiguration
POSTGRES_USER=loggplattform
POSTGRES_PASSWORD=mitt-säkra-lösenord-här
POSTGRES_DB=loggplattform
POSTGRES_PORT=5432
```

### 4. Starta applikationen

#### Med SQLite (standard):

```bash
# Ladda miljövariabler och starta
export $(grep -v '^#' .env | xargs)
docker-compose up -d --build
```

#### Med PostgreSQL:

```bash
# Ladda miljövariabler och starta med PostgreSQL
export $(grep -v '^#' .env | xargs)
docker-compose -f docker-compose.yml -f docker-compose.postgres.yml up -d --build
```

#### Eller använd start-skriptet (automatiskt):

```bash
chmod +x start.sh
./start.sh
```

### 5. Verifiera att allt fungerar

```bash
# Kontrollera att containrarna körs
docker-compose ps

# Kontrollera backend-hälsa
curl http://localhost:3001/health

# Öppna webbgränssnittet
open http://localhost:8080
# eller på Linux:
xdg-open http://localhost:8080
```

---

## 🔑 Skapa din första tjänst och API-nyckel

För att skicka loggar behöver du en API-nyckel:

```bash
# Skapa en tjänst (ersätt "min-app" med ditt tjänstnamn)
curl -X POST http://localhost:3001/api/services \
  -H "Content-Type: application/json" \
  -d '{"name": "min-app"}'
```

**Svaret innehåller din API-nyckel:**

```json
{
  "id": "abc123...",
  "name": "min-app",
  "api_key": "sk_abc123def456..."
}
```

**⚠️ Spara API-nyckeln! Den visas bara en gång.**

---

## 📦 Använda SDK:erna

### Node.js SDK

```bash
cd sdk-nodejs
npm install
```

```javascript
const LoggplattformSDK = require('./src/index.js');

const logger = new LoggplattformSDK({
  apiUrl: 'http://localhost:3001',
  apiKey: 'din-api-nyckel-här',  // Från steget ovan
  service: 'min-app',
  environment: 'development'
});

// Skicka loggar
logger.info('Applikationen startade');
logger.warn('Varning: Hög minnesanvändning');
logger.error('Fel vid databasanslutning', { error: 'Connection refused' });
logger.debug('Debug-info', { userId: 123, action: 'login' });

// Viktigt: Vänta på att loggar skickas innan programmet avslutas
await logger.flush();
```

### TypeScript SDK

```bash
cd sdk-typescript
npm install
npm run build
```

```typescript
import { LoggplattformSDK } from './src/index';

const logger = new LoggplattformSDK({
  apiUrl: 'http://localhost:3001',
  apiKey: 'din-api-nyckel-här',
  service: 'min-app'
});

logger.info('Applikationen startade');
logger.error('Ett fel uppstod', { errorCode: 500 });
```

### Java SDK

```bash
cd sdk-java
mvn clean install
```

```java
import com.loggplattform.sdk.LoggplattformSDK;
import java.util.HashMap;
import java.util.Map;

LoggplattformSDK logger = new LoggplattformSDK.Builder()
    .apiUrl("http://localhost:3001")
    .apiKey("din-api-nyckel-här")
    .service("min-app")
    .environment("development")
    .build();

// Enkla loggar
logger.info("Applikationen startade");
logger.warn("Varning");
logger.error("Fel uppstod");

// Med kontext
Map<String, Object> context = new HashMap<>();
context.put("userId", 123);
context.put("action", "login");
logger.debug("Användaraktivitet", context);

// Glöm inte stänga vid avslut
logger.shutdown();
```

---

## 🐘 Anslut till din egen PostgreSQL

Om du redan har en PostgreSQL-instans som körs i Docker eller på annan plats:

### 1. Hitta din PostgreSQL-anslutningssträng

```bash
# Format: postgresql://användare:lösenord@host:port/databas

# Exempel för lokal Docker PostgreSQL:
DATABASE_URL=postgresql://postgres:mittlösenord@localhost:5432/loggplattform

# Exempel för Docker-nätverk (om PostgreSQL körs i samma nätverk):
DATABASE_URL=postgresql://postgres:mittlösenord@postgres-container-name:5432/loggplattform
```

### 2. Lägg till i din `.env`-fil

```bash
# Din befintliga PostgreSQL
DATABASE_URL=postgresql://användare:lösenord@host:port/databas
```

### 3. Starta endast backend och web-ui (utan ny PostgreSQL)

```bash
export $(grep -v '^#' .env | xargs)
docker-compose up -d --build
```

Backend kommer automatiskt att använda PostgreSQL istället för SQLite när `DATABASE_URL` är satt.

### 4. Skapa tabellerna manuellt (om det behövs)

Om tabellerna inte skapas automatiskt, kör dessa i din PostgreSQL:

```sql
CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  api_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS logs (
  id TEXT PRIMARY KEY,
  timestamp TIMESTAMP NOT NULL,
  level TEXT NOT NULL,
  service TEXT NOT NULL,
  message TEXT NOT NULL,
  context TEXT,
  correlation_id TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_logs_service ON logs(service);
CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level);
CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_logs_correlation_id ON logs(correlation_id);
```

---

## 🛠️ Vanliga kommandon

### Starta/Stoppa

```bash
# Starta
docker-compose up -d

# Starta med PostgreSQL
docker-compose -f docker-compose.yml -f docker-compose.postgres.yml up -d

# Stoppa
docker-compose down

# Stoppa och ta bort data
docker-compose down -v
```

### Visa loggar

```bash
# Alla tjänster
docker-compose logs -f

# Endast backend
docker-compose logs -f backend

# Endast de senaste 100 raderna
docker-compose logs --tail=100 backend
```

### Bygga om efter ändringar

```bash
docker-compose up -d --build
```

---

## 🌐 Portar och URL:er

| Tjänst | Standard-port | URL |
|--------|--------------|-----|
| Backend API | 3001 | http://localhost:3001 |
| Web UI | 8080 | http://localhost:8080 |
| PostgreSQL | 5432 | localhost:5432 |

Ändra portarna i `.env`-filen:

```bash
BACKEND_PORT=4000
WEBUI_PORT=9090
POSTGRES_PORT=5433
```

---

## 🔍 Testa API:t direkt

### Skicka en logg

```bash
curl -X POST http://localhost:3001/api/logs \
  -H "X-API-Key: din-api-nyckel" \
  -H "Content-Type: application/json" \
  -d '{
    "level": "info",
    "message": "Test-logg från curl",
    "context": {"test": true}
  }'
```

### Hämta loggar

```bash
curl "http://localhost:3001/api/logs?limit=10" \
  -H "X-API-Key: din-api-nyckel"
```

### Filtrera loggar

```bash
# Endast fel
curl "http://localhost:3001/api/logs?level=error" \
  -H "X-API-Key: din-api-nyckel"

# Tidsspann
curl "http://localhost:3001/api/logs?start_time=2024-01-01T00:00:00Z&end_time=2024-12-31T23:59:59Z" \
  -H "X-API-Key: din-api-nyckel"
```

---

## ❓ Felsökning

### "ADMIN_API_KEY environment variable is required"

```bash
# Generera och sätt nyckeln
export ADMIN_API_KEY=$(openssl rand -hex 32)
echo "ADMIN_API_KEY=$ADMIN_API_KEY" >> .env
```

### Backend startar inte

```bash
# Kontrollera loggar
docker-compose logs backend

# Kontrollera att porten är ledig
lsof -i :3001
```

### Kan inte ansluta till PostgreSQL

```bash
# Kontrollera att PostgreSQL körs
docker-compose logs postgres

# Testa anslutningen
docker-compose exec postgres psql -U loggplattform -d loggplattform -c "SELECT 1"
```

### Webb-UI visar "Invalid API key"

1. Skapa en tjänst först (se "Skapa din första tjänst" ovan)
2. Ange API-nyckeln i webb-gränssnittet
3. API-nyckeln sparas i webbläsarens localStorage

---

## 📊 Miljövariabler - Komplett lista

| Variabel | Beskrivning | Standard |
|----------|-------------|----------|
| `ADMIN_API_KEY` | **Obligatorisk** - Admin API-nyckel | - |
| `BACKEND_PORT` | Backend-port | 3001 |
| `WEBUI_PORT` | Web UI-port | 8080 |
| `DATABASE_URL` | PostgreSQL-anslutning (tom = SQLite) | - |
| `DB_PATH` | SQLite-filsökväg | ./data/logs.db |
| `POSTGRES_USER` | PostgreSQL-användare | loggplattform |
| `POSTGRES_PASSWORD` | PostgreSQL-lösenord | - |
| `POSTGRES_DB` | PostgreSQL-databas | loggplattform |
| `POSTGRES_PORT` | PostgreSQL-port | 5432 |
| `LOG_LEVEL` | Loggnivå (debug/info/warn/error) | info |
| `ALLOWED_ORIGINS` | CORS-origins (kommaseparerade) | localhost |

---

## 🎉 Klart!

Du är nu redo att använda Loggplattform. Öppna http://localhost:8080 för att se dina loggar i webb-gränssnittet.

För mer information, se [README.md](README.md).
