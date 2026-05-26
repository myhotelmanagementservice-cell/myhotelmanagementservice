#!/bin/bash

echo "🚀 Starting Inaya Hotel Server..."

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Check if .env exists
if [ ! -f ".env" ]; then
    echo "⚠️  .env file not found! Creating from template..."
    cp .env.example .env 2>/dev/null || echo "Please create .env file"
fi

# Start server
npm start
