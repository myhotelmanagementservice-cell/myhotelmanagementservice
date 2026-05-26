const { MongoClient } = require('mongodb');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

let db;
let client;

async function connectDB() {
    if (db) return db;
    try {
        client = new MongoClient(process.env.MONGO_URI);
        await client.connect();
        db = client.db(process.env.DB_NAME || 'inaya_hotel');
        console.log('✅ Admin API: MongoDB connected');
        return db;
    } catch (error) {
        console.error('❌ Admin API DB Error:', error.message);
        return null;
    }
}

// Middleware to verify admin token
async function verifyAdmin(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ success: false, error: 'No token provided' });
    }
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
        req.adminId = decoded.id;
        next();
    } catch (error) {
        res.status(401).json({ success: false, error: 'Invalid token' });
    }
}

module.exports = { connectDB, verifyAdmin };
