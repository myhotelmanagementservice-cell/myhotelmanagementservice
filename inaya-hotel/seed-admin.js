// server/seed-admin.js
// Seed script to create initial super admin user
// Run: node server/seed-admin.js

const bcrypt = require('bcryptjs');
const { MongoClient } = require('mongodb');

// ============================================================
// CONFIGURATION
// ============================================================
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://hotel:hotelinaya@cluster0.hauipx7.mongodb.net/inaya_hotel?retryWrites=true&w=majority';
const DB_NAME = 'inaya_hotel';

const SUPER_ADMIN = {
    name: 'Super Admin',
    email: 'admin@inaya.com',
    password: 'admin123',
    role: 'super_admin',
    hotelId: 'SUPER_ADMIN',
    permissions: ['all']
};

// ============================================================
// SEED FUNCTION
// ============================================================
async function seedAdmin() {
    const client = new MongoClient(MONGO_URI);

    try {
        console.log('🔄 Connecting to MongoDB...');
        await client.connect();
        const db = client.db(DB_NAME);
        console.log('✅ Connected to database');

        // Check if admin already exists
        const existingAdmin = await db.collection('users').findOne({
            email: SUPER_ADMIN.email.toLowerCase()
        });

        if (existingAdmin) {
            console.log('⚠️  Super admin already exists:', SUPER_ADMIN.email);
            console.log('   Role:', existingAdmin.role);
            console.log('   Hotel:', existingAdmin.hotelId);
            return;
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(SUPER_ADMIN.password, 10);

        // Create admin user
        const adminUser = {
            email: SUPER_ADMIN.email.toLowerCase(),
            password: hashedPassword,
            name: SUPER_ADMIN.name,
            role: SUPER_ADMIN.role,
            hotelId: SUPER_ADMIN.hotelId,
            permissions: SUPER_ADMIN.permissions,
            active: true,
            status: 'active',
            loginCount: 0,
            lastLogin: null,
            _version: 1,
            isDeleted: false,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = await db.collection('users').insertOne(adminUser);

        console.log('\n✅✅✅ SUPER ADMIN CREATED ✅✅✅');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📧 Email:    ', SUPER_ADMIN.email);
        console.log('🔑 Password: ', SUPER_ADMIN.password);
        console.log('🏨 Hotel ID: ', SUPER_ADMIN.hotelId);
        console.log('👤 Role:     ', SUPER_ADMIN.role);
        console.log('🆔 User ID:  ', result.insertedId.toString());
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        // Also create the SUPER_ADMIN tenant entry
        const tenantExists = await db.collection('tenants').findOne({
            hotelId: SUPER_ADMIN.hotelId
        });

        if (!tenantExists) {
            await db.collection('tenants').insertOne({
                hotelId: SUPER_ADMIN.hotelId,
                hotelName: 'Super Admin Panel',
                adminEmail: SUPER_ADMIN.email.toLowerCase(),
                currency: 'USD',
                currencySymbol: '$',
                language: 'en',
                country: 'System',
                timezone: 'UTC',
                active: true,
                theme: 'default',
                subscriptionType: 'lifetime',
                subscriptionExpiry: null,
                createdAt: new Date(),
                updatedAt: new Date()
            });
            console.log('✅ Super admin tenant entry created');
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    } finally {
        await client.close();
        console.log('🔌 Database connection closed');
        process.exit(0);
    }
}

// Run the seed
seedAdmin();