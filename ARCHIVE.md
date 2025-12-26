# 📦 Arkiveringssystem

## Översikt

Loggplattform använder ett hybridsystem för lagring:
- **Databas (SQLite):** Senaste loggarna (konfigurerbart, standard 1 dag)
- **Arkiverade filer (JSONL):** Äldre loggar sparas som filer

Detta gör det möjligt att hantera miljarder loggar utan att databasen blir för stor.

## Hur det fungerar

### Arkivering

1. **Schemalagd arkivering:** Varje dag kl 02:00 UTC körs ett jobb som:
   - Hämtar loggar äldre än 1 dag från databasen
   - Sparar dem som JSONL-filer (en fil per service per dag)
   - Tar bort dem från databasen

2. **Filstruktur:**
   ```
   data/archives/
   ├── 2024-01-15/
   │   ├── service-a.jsonl
   │   ├── service-b.jsonl
   │   └── service-c.jsonl
   ├── 2024-01-16/
   │   └── ...
   ```

3. **JSONL-format:** Varje rad är en JSON-objekt:
   ```json
   {"id":"...","timestamp":"...","level":"info","service":"...","message":"..."}
   {"id":"...","timestamp":"...","level":"error","service":"...","message":"..."}
   ```

### Läsning

När du söker efter loggar (`GET /api/logs`):

1. Systemet läser från både databas och arkiverade filer
2. Kombinerar resultaten
3. Deduplicerar (om samma logg finns i båda)
4. Sorterar efter timestamp (nyaste först)
5. Applicerar paginering

**Exempel:** Om du söker efter loggar från senaste 7 dagarna:
- Databas: Loggar från senaste 1 dag
- Arkiv: Loggar från dag 2-7 (från filer)
- Kombineras och returneras tillsammans

### Rensning

Varje dag kl 03:00 UTC körs ett rensningsjobb som:
- Tar bort arkiv äldre än 30 dagar (konfigurerbart)
- Sparar diskutrymme automatiskt

## Konfiguration

Miljövariabler i `.env` eller `docker-compose.yml`:

```bash
# Arkiveringsschema (cron-format)
ARCHIVE_SCHEDULE=0 2 * * *        # Dagligen kl 02:00 UTC

# Hur gamla loggar ska arkiveras
ARCHIVE_DAYS_OLD=1                # Arkivera loggar äldre än 1 dag

# Hur länge arkiv behålls
ARCHIVE_RETENTION_DAYS=30         # Rensa arkiv äldre än 30 dagar

# Batch-storlek för arkivering
ARCHIVE_BATCH_SIZE=10000          # Arkivera 10000 loggar åt gången

# Rensningsschema
CLEANUP_SCHEDULE=0 3 * * *        # Dagligen kl 03:00 UTC

# Arkiveringskatalog
ARCHIVE_DIR=./data/archives       # Var arkiv sparas
```

## Manuell hantering

### Arkivera nu

```bash
curl -X POST http://localhost:3000/api/admin/archive-now \
  -H "X-API-Key: your-admin-api-key"
```

### Arkivera specifik ålder

```bash
curl -X POST http://localhost:3000/api/admin/archive \
  -H "X-API-Key: your-admin-api-key" \
  -H "Content-Type: application/json" \
  -d '{"daysOld": 7}'
```

### Rensa gamla arkiv

```bash
curl -X POST http://localhost:3000/api/admin/cleanup \
  -H "X-API-Key: your-admin-api-key"
```

## Prestanda

### Lagring

- **Databas:** Snabb för senaste loggar, begränsad storlek
- **Arkiv:** Skalbar för miljarder loggar, långsammare läsning

### Läsning

- **Kombinerad sökning:** Systemet läser från båda källor parallellt
- **Deduplicering:** Automatisk hantering av överlappningar
- **Sortering:** Efter timestamp (nyaste först)
- **Paginering:** Stöd för `limit` och `offset`

## Best Practices

1. **Anpassa arkiveringsintervall:** 
   - Om du har många loggar: Arkivera oftare (t.ex. var 12:e timme)
   - Om du har få loggar: Arkivera sällan (t.ex. var 7:e dag)

2. **Anpassa retention:**
   - Längre retention = mer diskutrymme
   - Kortare retention = mindre diskutrymme men förlorar historik

3. **Övervaka diskutrymme:**
   - Arkiverade filer kan bli stora
   - Överväg komprimering för mycket gamla arkiv

4. **Backup:**
   - Arkiverade filer är enklare att backa upp än databas
   - Överväg att backa upp arkiv-katalogen regelbundet

## Exempel

### Scenario: 1 miljard loggar/dag

Med standardinställningar:
- **Databas:** ~1 miljard loggar (senaste dagen)
- **Arkiv:** ~30 miljarder loggar (30 dagar)
- **Totalt:** ~31 miljarder loggar hanterbara

### Diskutrymme

Antag ~500 bytes per logg:
- **Databas:** ~500 GB (1 dag)
- **Arkiv:** ~15 TB (30 dagar)
- **Totalt:** ~15.5 TB

## Felsökning

### Arkiveringen körs inte

1. Kontrollera att schedulern startar:
   ```
   Logs should show: "Starting archive scheduler..."
   ```

2. Kontrollera cron-schemat:
   ```bash
   # Testa manuellt
   curl -X POST http://localhost:3000/api/admin/archive-now \
     -H "X-API-Key: your-admin-api-key"
   ```

3. Kontrollera diskutrymme:
   ```bash
   df -h data/archives
   ```

### Långsam läsning

1. Begränsa tidsintervall i sökningar
2. Använd filtrering (level, correlation_id)
3. Överväg att öka `ARCHIVE_DAYS_OLD` för att behålla mer i databasen

### Diskutrymme tar slut

1. Minska `ARCHIVE_RETENTION_DAYS`
2. Kör manuell rensning:
   ```bash
   curl -X POST http://localhost:3000/api/admin/cleanup \
     -H "X-API-Key: your-admin-api-key"
   ```
3. Överväg att flytta gamla arkiv till kyla lagring
