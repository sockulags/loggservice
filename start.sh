#!/bin/bash

echo "🚀 Starting Loggplattform..."
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker and try again."
    exit 1
fi

# Load .env file if it exists
if [ -f .env ]; then
    echo "📋 Loading configuration from .env file..."
    export $(grep -v '^#' .env | xargs)
fi

# Check for required environment variables
if [ -z "$ADMIN_API_KEY" ]; then
    echo "⚠️  ADMIN_API_KEY is not set. Generating a random key..."
    export ADMIN_API_KEY=$(openssl rand -hex 32)
    echo "   Generated ADMIN_API_KEY: $ADMIN_API_KEY"
    echo ""
    echo "   💡 Tip: Save this to your .env file:"
    echo "   echo 'ADMIN_API_KEY=$ADMIN_API_KEY' >> .env"
    echo ""
fi

# Determine which compose files to use
COMPOSE_FILES="-f docker-compose.yml"

if [ -n "$DATABASE_URL" ] || [ "$USE_POSTGRES" = "true" ]; then
    echo "🐘 PostgreSQL mode enabled"
    
    # Check for PostgreSQL password
    if [ -z "$POSTGRES_PASSWORD" ]; then
        echo "⚠️  POSTGRES_PASSWORD is not set. Generating a random password..."
        export POSTGRES_PASSWORD=$(openssl rand -hex 16)
        echo "   Generated POSTGRES_PASSWORD: $POSTGRES_PASSWORD"
    fi
    
    COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.postgres.yml"
else
    echo "💾 SQLite mode (default)"
fi

# Get configured ports
BACKEND_PORT=${BACKEND_PORT:-3001}
WEBUI_PORT=${WEBUI_PORT:-8080}

# Build and start services
echo ""
echo "📦 Building and starting services..."
docker-compose $COMPOSE_FILES up -d --build

echo ""
echo "⏳ Waiting for services to be ready..."
sleep 5

# Check if backend is healthy
if curl -s http://localhost:$BACKEND_PORT/health > /dev/null; then
    echo "✅ Backend is running on http://localhost:$BACKEND_PORT"
else
    echo "⚠️  Backend might still be starting..."
fi

echo ""
echo "✅ Loggplattform is starting!"
echo ""
echo "📱 Web UI: http://localhost:$WEBUI_PORT"
echo "🔌 API: http://localhost:$BACKEND_PORT"
echo ""
echo "To view logs: docker-compose $COMPOSE_FILES logs -f"
echo "To stop: docker-compose $COMPOSE_FILES down"
echo ""
