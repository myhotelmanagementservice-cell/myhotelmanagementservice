#!/bin/bash
echo "========================================="
echo "🔧 Building Inaya Hotel Application..."
echo "========================================="

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Create necessary directories
mkdir -p logs
mkdir -p uploads

# Check if .env exists, if not create from example
if [ ! -f .env ]; then
    echo "📝 Creating .env file..."
    cat > .env << 'ENVEOF'
MONGO_URI=mongodb+srv://hotel:hotelinaya@cluster0.hauipx7.mongodb.net/inaya_hotel?retryWrites=true&w=majority&appName=Cluster0
DB_NAME=inaya_hotel
PORT=8080
NODE_ENV=production
JWT_SECRET=inaya_hotel_secret_2025
ENVEOF
fi

echo "✅ Build completed successfully!"
exit 0
