cat > server/config/db.js << 'EOF'
const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI);
    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
    console.log(`📦 Database: ${conn.connection.name}`);
  } catch (err) {
    console.error('❌ MongoDB Error:', err.message);
    process.exit(1);
  }
};

module.exports = connectDB;
EOF