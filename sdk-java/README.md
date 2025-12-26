# Loggplattform Java SDK

SDK för att skicka loggar till Loggplattform från Java-applikationer.

## Installation

Lägg till beroendet i din `pom.xml`:

```xml
<dependency>
    <groupId>com.loggplattform</groupId>
    <artifactId>sdk-java</artifactId>
    <version>1.0.0</version>
</dependency>
```

Eller bygg från källkod:

```bash
mvn clean install
```

## Användning

### Grundläggande användning

```java
import com.loggplattform.sdk.LoggplattformSDK;

LoggplattformSDK logger = new LoggplattformSDK.Builder()
    .apiUrl("http://localhost:3000")
    .apiKey("your-api-key-here")
    .service("my-service")
    .environment("production")
    .build();

// Skicka loggar
logger.info("Application started");
logger.warn("High memory usage detected");
logger.error("Failed to connect to database");
logger.debug("Processing request");
```

### Med miljövariabler

```bash
export LOGGPLATTFORM_API_URL=http://localhost:3000
export LOGGPLATTFORM_API_KEY=your-api-key-here
export LOGGPLATTFORM_SERVICE=my-service
```

```java
LoggplattformSDK logger = new LoggplattformSDK();
logger.info("Using environment variables");
```

### Med kontext

```java
Map<String, Object> context = new HashMap<>();
context.put("userId", 123);
context.put("email", "user@example.com");
context.put("ip", "192.168.1.1");

logger.info("User logged in", context);
```

### Med korrelations-ID

```java
String correlationId = UUID.randomUUID().toString();
logger.setCorrelationId(correlationId);

logger.info("Request started");
logger.debug("Database query");
logger.info("Request completed");
```

## API

### `LoggplattformSDK.Builder`

Byggare för att skapa SDK-instanser.

**Metoder:**
- `apiUrl(String url)` - URL till loggplattform API
- `apiKey(String key)` - API-nyckel för autentisering
- `service(String service)` - Tjänstnamn
- `environment(String env)` - Miljö
- `correlationId(String id)` - Korrelations-ID
- `flushIntervalSeconds(int seconds)` - Intervall för att skicka loggar
- `build()` - Skapa SDK-instans

### Metoder

- `logger.info(message)` / `logger.info(message, context)` - Skicka info-logg
- `logger.warn(message)` / `logger.warn(message, context)` - Skicka varning
- `logger.error(message)` / `logger.error(message, context)` - Skicka fel
- `logger.debug(message)` / `logger.debug(message, context)` - Skicka debug-logg
- `logger.setCorrelationId(id)` - Sätt korrelations-ID
- `logger.flush()` - Skicka alla väntande loggar asynkront
- `logger.flushSync()` - Skicka alla väntande loggar synkront
- `logger.shutdown()` - Stäng SDK och skicka alla väntande loggar

## Säkerhet

SDK:ns fel kraschar aldrig applikationen. Om loggning misslyckas fortsätter applikationen att fungera normalt.
