#!/bin/bash

echo "🚀 Starting Loggplattform..."
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker and try again."
    exit 1
fi

# Build and start services
echo "📦 Building and starting services..."
docker-compose up -d --build

echo ""
echo "⏳ Waiting for services to be ready..."
sleep 5

# Check if backend is healthy
if curl -s http://localhost:3000/health > /dev/null; then
    echo "✅ Backend is running on http://localhost:3000"
else
    echo "⚠️  Backend might still be starting..."
fi

echo ""
echo "✅ Loggplattform is starting!"
echo ""
echo "📱 Web UI: http://localhost:8080"
echo "🔌 API: http://localhost:3000"
echo ""
echo "To view logs: docker-compose logs -f"
echo "To stop: docker-compose down"
echo ""
