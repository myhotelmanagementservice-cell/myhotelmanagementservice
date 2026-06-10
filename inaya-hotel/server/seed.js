// server/seed.js - UPDATED VERSION (Fixed duplicate key error)
require("dotenv").config({ path: __dirname + "/.env" });
const { MongoClient } = require('mongodb');
const bcrypt = require('bcryptjs');

const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb+srv://hotel:hotelinaya@cluster0.hauipx7.mongodb.net/inaya_hotel?retryWrites=true&w=majority&appName=Cluster0';
const DB_NAME = process.env.DB_NAME || 'inaya_hotel';

// ==================== 🎯 DEFAULT CREDENTIALS ====================
const SUPER_ADMIN = {
  email: 'superadmin@crownplaza.com',
  password: 'SuperAdmin@2024',
  name: 'Super Admin',
  role: 'super_admin',
  hotelId: 'SUPER_ADMIN'  // ✅ Added hotelId
};

const DEFAULT_HOTEL = {
  hotelId: 'CROWN-DEFAULT',
  hotelName: 'Crown Plaza Hotel',
  adminEmail: 'admin@crownplaza.com',
  adminPassword: 'admin123',
  currency: 'SAR',
  currencySymbol: '﷼',
  language: 'en',
  country: 'Saudi Arabia',
  timezone: 'Asia/Riyadh',
  subscriptionType: 'enterprise'
};

// ==================== 🚀 MAIN SEED FUNCTION ====================
async function seedDatabase() {
  let client;

  try {
    console.log('\n' + '═'.repeat(60));
    console.log('  🌱  SEEDING DATABASE WITH DEFAULT DATA');
    console.log('═'.repeat(60) + '\n');

    client = new MongoClient(MONGODB_URI);
    await client.connect();
    const db = client.db(DB_NAME);

    console.log('✅ Connected to MongoDB\n');

    // ==================== 1. CREATE SUPER ADMIN ====================
    console.log('👑 Step 1: Creating Super Admin...');

    // ✅ FIXED: Check with hotelId
    const superAdminExists = await db.collection('users').findOne({ 
      email: SUPER_ADMIN.email,
      hotelId: SUPER_ADMIN.hotelId
    });

    if (superAdminExists) {
      console.log(`⚠️  Super Admin already exists: ${SUPER_ADMIN.email}`);
    } else {
      // ✅ FIXED: Also check if email exists globally (for safety)
      const emailExistsGlobally = await db.collection('users').findOne({ 
        email: SUPER_ADMIN.email 
      });

      if (emailExistsGlobally) {
        console.log(`⚠️  Email ${SUPER_ADMIN.email} already exists with different hotelId`);
        console.log(`   Updating to super_admin role...`);

        await db.collection('users').updateOne(
          { email: SUPER_ADMIN.email },
          { 
            $set: { 
              role: 'super_admin',
              hotelId: SUPER_ADMIN.hotelId,
              permissions: ['all'],
              active: true
            } 
          }
        );
        console.log(`✅ Updated existing user to Super Admin`);
      } else {
        const hashedPassword = await bcrypt.hash(SUPER_ADMIN.password, 10);
        await db.collection('users').insertOne({
          email: SUPER_ADMIN.email,
          password: hashedPassword,
          name: SUPER_ADMIN.name,
          role: SUPER_ADMIN.role,
          hotelId: SUPER_ADMIN.hotelId,
          permissions: ['all'],
          active: true,
          createdAt: new Date()
        });
        console.log(`✅ Super Admin created: ${SUPER_ADMIN.email}`);
      }
    }

    // ==================== 2. CREATE DEFAULT HOTEL ====================
    console.log('\n🏨 Step 2: Creating Default Hotel...');
    const hotelExists = await db.collection('tenants').findOne({ 
      hotelId: DEFAULT_HOTEL.hotelId 
    });

    if (hotelExists) {
      console.log(`⚠️  Hotel already exists: ${DEFAULT_HOTEL.hotelId}`);
    } else {
      let subscriptionExpiry;
      if (DEFAULT_HOTEL.subscriptionType === 'enterprise') {
        subscriptionExpiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
      } else if (DEFAULT_HOTEL.subscriptionType === 'pro') {
        subscriptionExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      } else {
        subscriptionExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      }

      await db.collection('tenants').insertOne({
        hotelId: DEFAULT_HOTEL.hotelId,
        hotelName: DEFAULT_HOTEL.hotelName,
        logo: null,
        currency: DEFAULT_HOTEL.currency,
        currencySymbol: DEFAULT_HOTEL.currencySymbol,
        language: DEFAULT_HOTEL.language,
        country: DEFAULT_HOTEL.country,
        timezone: DEFAULT_HOTEL.timezone,
        active: true,
        theme: 'default',
        subscriptionType: DEFAULT_HOTEL.subscriptionType,
        subscriptionExpiry,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      console.log(`✅ Hotel created: ${DEFAULT_HOTEL.hotelName}`);
    }

    // ==================== 3. CREATE HOTEL ADMIN ====================
    console.log('\n👤 Step 3: Creating Hotel Admin...');

    // ✅ FIXED: Check with hotelId
    const adminExists = await db.collection('users').findOne({ 
      email: DEFAULT_HOTEL.adminEmail,
      hotelId: DEFAULT_HOTEL.hotelId
    });

    if (adminExists) {
      console.log(`⚠️  Hotel Admin already exists: ${DEFAULT_HOTEL.adminEmail}`);
    } else {
      // ✅ FIXED: Check if email exists globally
      const emailExistsGlobally = await db.collection('users').findOne({ 
        email: DEFAULT_HOTEL.adminEmail 
      });

      if (emailExistsGlobally) {
        console.log(`⚠️  Email ${DEFAULT_HOTEL.adminEmail} already exists`);
        console.log(`   Updating to admin role for this hotel...`);

        await db.collection('users').updateOne(
          { email: DEFAULT_HOTEL.adminEmail },
          { 
            $set: { 
              role: 'admin',
              hotelId: DEFAULT_HOTEL.hotelId,
              permissions: ['rooms', 'guests', 'food', 'inventory', 'requests', 'settings', 'staff', 'bookings'],
              active: true
            } 
          }
        );
        console.log(`✅ Updated existing user to Hotel Admin`);
      } else {
        const hashedPassword = await bcrypt.hash(DEFAULT_HOTEL.adminPassword, 10);
        await db.collection('users').insertOne({
          email: DEFAULT_HOTEL.adminEmail,
          password: hashedPassword,
          name: 'Hotel Admin',
          role: 'admin',
          hotelId: DEFAULT_HOTEL.hotelId,
          permissions: ['rooms', 'guests', 'food', 'inventory', 'requests', 'settings', 'staff', 'bookings'],
          active: true,
          createdAt: new Date()
        });
        console.log(`✅ Hotel Admin created: ${DEFAULT_HOTEL.adminEmail}`);
      }
    }

    // ==================== 4. CREATE DEFAULT SETTINGS ====================
    console.log('\n⚙️  Step 4: Creating Default Settings...');
    const settingsExist = await db.collection('settings').findOne({ 
      hotelId: DEFAULT_HOTEL.hotelId 
    });

    if (settingsExist) {
      console.log(`⚠️  Settings already exist for: ${DEFAULT_HOTEL.hotelId}`);
    } else {
      await db.collection('settings').insertOne({
        hotelId: DEFAULT_HOTEL.hotelId,
        hotelName: DEFAULT_HOTEL.hotelName,
        currency: DEFAULT_HOTEL.currency,
        currencySymbol: DEFAULT_HOTEL.currencySymbol,
        priceFormat: 'symbol-first',
        taxRate: 0,
        wifiSSID: `${DEFAULT_HOTEL.hotelName.replace(/\s+/g, '_')}_Guest`,
        wifiPassword: 'Welcome123',
        language: DEFAULT_HOTEL.language,
        theme: { primaryColor: '#667eea' },
        transport: { airport: 115, local: 60 },
        updatedAt: new Date()
      });
      console.log('✅ Default settings created');
    }

    // ==================== 5. CREATE 50 DEFAULT ROOMS ====================
    console.log('\n🛏️  Step 5: Creating 50 Default Rooms...');
    const roomsCount = await db.collection('rooms').countDocuments({ 
      hotelId: DEFAULT_HOTEL.hotelId 
    });

    if (roomsCount > 0) {
      console.log(`⚠️  Rooms already exist: ${roomsCount} rooms`);
    } else {
      const types = ['Standard', 'Deluxe', 'Suite'];
      const basePricesSAR = { Standard: 371, Deluxe: 484, Suite: 746 };
      const roomsToInsert = [];

      for (let i = 101; i <= 150; i++) {
        const type = types[(i - 101) % 3];
        roomsToInsert.push({
          hotelId: DEFAULT_HOTEL.hotelId,
          number: i,
          type: type,
          basePriceSAR: basePricesSAR[type],
          price: basePricesSAR[type],
          status: 'Vacant',
          guestName: '',
          amenities: [],
          createdAt: new Date(),
          updatedAt: new Date(),
          _version: 1
        });
      }

      await db.collection('rooms').insertMany(roomsToInsert);
      console.log(`✅ 50 rooms created (101-150)`);
    }

    // ==================== 6. CREATE 25 DEFAULT FOOD ITEMS ====================
    console.log('\n🍽️  Step 6: Creating 25 Default Food Items...');
    const foodCount = await db.collection('food').countDocuments({ 
      hotelId: DEFAULT_HOTEL.hotelId 
    });

    if (foodCount > 0) {
      console.log(`⚠️  Food items already exist: ${foodCount} items`);
    } else {
      const foodItems = [
        { name: 'Burger', price: 45, basePriceSAR: 45, category: 'Main Course', emoji: '🍔' },
        { name: 'Pizza', price: 56, basePriceSAR: 56, category: 'Main Course', emoji: '🍕' },
        { name: 'Pasta', price: 53, basePriceSAR: 53, category: 'Main Course', emoji: '🍝' },
        { name: 'Kabsa', price: 83, basePriceSAR: 83, category: 'Saudi Cuisine', emoji: '🍛' },
        { name: 'Shawarma', price: 38, basePriceSAR: 38, category: 'Saudi Cuisine', emoji: '🌯' },
        { name: 'Mandi', price: 75, basePriceSAR: 75, category: 'Saudi Cuisine', emoji: '🍲' },
        { name: 'Jareesh', price: 45, basePriceSAR: 45, category: 'Saudi Cuisine', emoji: '🥣' },
        { name: 'Saleeg', price: 56, basePriceSAR: 56, category: 'Saudi Cuisine', emoji: '🍚' },
        { name: 'Mathrooba', price: 53, basePriceSAR: 53, category: 'Saudi Cuisine', emoji: '🥘' },
        { name: 'Mutabbaq', price: 30, basePriceSAR: 30, category: 'Saudi Cuisine', emoji: '🥙' },
        { name: 'Kleija', price: 23, basePriceSAR: 23, category: 'Dessert', emoji: '🍪' },
        { name: 'Luqaimat', price: 26, basePriceSAR: 26, category: 'Dessert', emoji: '🍩' },
        { name: 'Maamoul', price: 30, basePriceSAR: 30, category: 'Dessert', emoji: '🧁' },
        { name: 'Basbousa', price: 34, basePriceSAR: 34, category: 'Dessert', emoji: '🍰' },
        { name: 'Umm Ali', price: 38, basePriceSAR: 38, category: 'Dessert', emoji: '🍮' },
        { name: 'Arabic Coffee', price: 19, basePriceSAR: 19, category: 'Beverage', emoji: '☕' },
        { name: 'Saudi Tea', price: 15, basePriceSAR: 15, category: 'Beverage', emoji: '🍵' },
        { name: 'Jallab', price: 23, basePriceSAR: 23, category: 'Beverage', emoji: '🥤' },
        { name: 'Tamarind Drink', price: 19, basePriceSAR: 19, category: 'Beverage', emoji: '🧃' },
        { name: 'Lab Ban', price: 15, basePriceSAR: 15, category: 'Beverage', emoji: '🥛' },
        { name: 'Camel Milk', price: 30, basePriceSAR: 30, category: 'Beverage', emoji: '🐫' },
        { name: 'Dates', price: 26, basePriceSAR: 26, category: 'Appetizer', emoji: '🌴' },
        { name: 'Hummus', price: 23, basePriceSAR: 23, category: 'Appetizer', emoji: '🥙' },
        { name: 'Mutabbal', price: 26, basePriceSAR: 26, category: 'Appetizer', emoji: '🫔' },
        { name: 'Sambousek', price: 34, basePriceSAR: 34, category: 'Appetizer', emoji: '🥟' }
      ];

      const foodToInsert = foodItems.map((item, idx) => ({
        ...item,
        hotelId: DEFAULT_HOTEL.hotelId,
        description: '',
        available: true,
        image: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        _version: 1
      }));

      await db.collection('food').insertMany(foodToInsert);
      console.log(`✅ 25 food items created`);
    }

    // ==================== 7. CREATE 25 DEFAULT INVENTORY ITEMS ====================
    console.log('\n📦 Step 7: Creating 25 Default Inventory Items...');
    const invCount = await db.collection('inventory').countDocuments({ 
      hotelId: DEFAULT_HOTEL.hotelId 
    });

    if (invCount > 0) {
      console.log(`⚠️  Inventory items already exist: ${invCount} items`);
    } else {
      const inventoryItems = [
        { name: 'Towels', category: 'Amenities', stock: 150, unit: 'pcs', min: 50 },
        { name: 'Bed Sheets', category: 'Linen', stock: 80, unit: 'sets', min: 30 },
        { name: 'Pillows', category: 'Linen', stock: 60, unit: 'pcs', min: 20 },
        { name: 'Shampoo', category: 'Amenities', stock: 200, unit: 'bottles', min: 50 },
        { name: 'Soap', category: 'Amenities', stock: 300, unit: 'bars', min: 100 },
        { name: 'Slippers', category: 'Amenities', stock: 100, unit: 'pairs', min: 30 },
        { name: 'Bathrobe', category: 'Linen', stock: 40, unit: 'pcs', min: 10 },
        { name: 'Qibla Direction Card', category: 'Religious', stock: 50, unit: 'cards', min: 10 },
        { name: 'Prayer Mat', category: 'Religious', stock: 50, unit: 'pcs', min: 10 },
        { name: 'Miswak', category: 'Religious', stock: 100, unit: 'sticks', min: 20 },
        { name: 'ZamZam Water', category: 'Beverage', stock: 200, unit: 'bottles', min: 50 },
        { name: 'Dates Box', category: 'Food', stock: 150, unit: 'boxes', min: 30 },
        { name: 'Arabic Coffee Set', category: 'Amenities', stock: 30, unit: 'sets', min: 5 },
        { name: 'Oud Perfume', category: 'Amenities', stock: 40, unit: 'bottles', min: 10 },
        { name: 'Bakhoor Incense', category: 'Amenities', stock: 50, unit: 'boxes', min: 10 },
        { name: 'Thobe', category: 'Clothing', stock: 30, unit: 'pcs', min: 5 },
        { name: 'Abaya', category: 'Clothing', stock: 30, unit: 'pcs', min: 5 },
        { name: 'Kandura', category: 'Clothing', stock: 30, unit: 'pcs', min: 5 },
        { name: 'Tissue Box', category: 'Amenities', stock: 200, unit: 'boxes', min: 50 },
        { name: 'Dental Kit', category: 'Amenities', stock: 150, unit: 'kits', min: 30 },
        { name: 'Sewing Kit', category: 'Amenities', stock: 100, unit: 'kits', min: 20 },
        { name: 'Shoe Mitt', category: 'Amenities', stock: 80, unit: 'pcs', min: 20 },
        { name: 'Laundry Bag', category: 'Linen', stock: 60, unit: 'pcs', min: 15 },
        { name: 'Iron', category: 'Equipment', stock: 20, unit: 'pcs', min: 5 },
        { name: 'Hair Dryer', category: 'Equipment', stock: 25, unit: 'pcs', min: 5 }
      ];

      const invToInsert = inventoryItems.map(item => ({
        ...item,
        hotelId: DEFAULT_HOTEL.hotelId,
        price: 0,
        status: item.stock <= item.min ? 'low-stock' : 'in-stock',
        createdAt: new Date(),
        updatedAt: new Date(),
        _version: 1
      }));

      await db.collection('inventory').insertMany(invToInsert);
      console.log(`✅ 25 inventory items created`);
    }

    // ==================== FINAL SUMMARY ====================
    console.log('\n' + '═'.repeat(60));
    console.log('  ✅  SEEDING COMPLETED SUCCESSFULLY!');
    console.log('═'.repeat(60));
    console.log('\n📋 DEFAULT CREDENTIALS:\n');
    console.log('  👑 Super Admin:');
    console.log(`     Email:    ${SUPER_ADMIN.email}`);
    console.log(`     Password: ${SUPER_ADMIN.password}`);
    console.log(`     Hotel ID: ${SUPER_ADMIN.hotelId}`);
    console.log(`     URL:      http://localhost:3000/super-admin.html\n`);

    console.log('  🏨 Hotel Admin:');
    console.log(`     Email:    ${DEFAULT_HOTEL.adminEmail}`);
    console.log(`     Password: ${DEFAULT_HOTEL.adminPassword}`);
    console.log(`     Hotel ID: ${DEFAULT_HOTEL.hotelId}`);
    console.log(`     URL:      http://localhost:3000/?hotel=${DEFAULT_HOTEL.hotelId}\n`);

    console.log('═'.repeat(60) + '\n');

  } catch (error) {
    console.error('\n❌ SEEDING ERROR:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    if (client) {
      await client.close();
      console.log('✅ MongoDB connection closed\n');
    }
  }
}

// Run the seed function
seedDatabase();