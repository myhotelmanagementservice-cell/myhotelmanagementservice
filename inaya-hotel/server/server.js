 // server.js - Complete Multi-Tenant Hotel SaaS Backend
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// ✅ Socket.io Setup with CORS
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../inaya-hotel/public')));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'inaya-hotel-secret-key-change-in-production',
  resave: false,
  saveUninitialized: true,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));

// ==================== CONFIG ====================
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb+srv://hotel:hotelinaya@cluster0.hauipx7.mongodb.net/inaya_hotel?retryWrites=true&w=majority&appName=Cluster0';
const DB_NAME = process.env.DB_NAME || 'inaya_hotel';

let db;
let client;

// ==================== MONGODB CONNECTION ====================
async function connectDB() {
  try {
    console.log('🔄 Connecting to MongoDB Atlas...');
    client = new MongoClient(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 30000
    });
    await client.connect();
    db = client.db(DB_NAME);
    await db.command({ ping: 1 });
    console.log('✅ MongoDB Connected Successfully!');

    // Create indexes for multi-tenant queries
    await createIndexes();
    return db;
  } catch (error) {
    console.error('❌ MongoDB Connection Error:', error.message);
    // Retry connection after 5 seconds
    setTimeout(connectDB, 5000);
    return null;
  }
}

// ✅ Create indexes for performance + multi-tenant isolation
async function createIndexes() {
  try {
    const collections = ['rooms', 'guests', 'food', 'inventory', 'requests', 'blacklist', 'maintenance', 'reviews', 'loyalty', 'staff', 'logs', 'settings', 'tenants'];
    for (const col of collections) {
      await db.collection(col).createIndex({ hotelId: 1 }, { background: true });
      if (col === 'rooms') await db.collection(col).createIndex({ number: 1, hotelId: 1 }, { unique: true, background: true });
      if (col === 'guests') await db.collection(col).createIndex({ email: 1, hotelId: 1 }, { background: true });
      if (col === 'settings') await db.collection(col).createIndex({ hotelId: 1 }, { unique: true, background: true });
      if (col === 'tenants') await db.collection(col).createIndex({ hotelId: 1 }, { unique: true, background: true });
    }
    console.log('✅ Indexes created for multi-tenant queries');
  } catch (e) {
    console.error('⚠️ Index creation warning:', e.message);
  }
}

// ==================== MULTI-TENANT MIDDLEWARE ====================
// Extract hotelId from header, query, or session - fallback to 'default'
const getHotelId = (req) => {
  return req.headers['x-hotel-id'] || 
         req.query.hotelId || 
         req.query.hotel || 
         (req.session?.hotelId) || 
         'default';
};

// Middleware to attach hotelId to request
const tenantMiddleware = (req, res, next) => {
  req.hotelId = getHotelId(req);
  next();
};

// Apply tenant middleware to all API routes
app.use('/api', tenantMiddleware);

// ==================== SOCKET.IO REAL-TIME ====================
io.on('connection', (socket) => {
  console.log('🔌 Client connected:', socket.id);

  // Join hotel-specific room for real-time sync
  socket.on('joinHotel', (hotelId) => {
    socket.join(`hotel_${hotelId}`);
    console.log(`📡 ${socket.id} joined room: hotel_${hotelId}`);
    socket.emit('connected', { hotelId, message: 'Connected to hotel channel' });
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('🔌 Client disconnected:', socket.id);
  });

  // Handle errors
  socket.on('error', (error) => {
    console.error('⚠️ Socket error:', error);
  });
});

// ✅ Broadcast helper - sends update to all devices in same hotel
const broadcast = (hotelId, event, data) => {
  io.to(`hotel_${hotelId}`).emit(event, data);
  console.log(`📡 Broadcast ${event} to hotel_${hotelId}`);
};

// ==================== HEALTH CHECK ====================
app.get('/api/health', (req, res) => {
  res.json({ 
    message: 'Inaya Hotel Management System API', 
    status: 'OK',
    mongodb: db ? 'connected' : 'disconnected',
    socket: io.engine.clientsCount,
    timestamp: new Date().toISOString()
  });
});

// ==================== TENANT MANAGEMENT ====================

// Get tenant config by hotelId
app.get('/api/tenant', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const tenant = await db.collection('tenants').findOne({ hotelId });

    if (!tenant) {
      // Return default config if tenant not found
      return res.json({ 
        success: true, 
        data: { 
          hotelId, 
          hotelName: 'Crown Plaza Hotel',
          currency: 'USD',
          language: 'en',
          country: 'USA',
          active: true,
          theme: 'default',
          subscriptionType: 'basic'
        } 
      });
    }

    res.json({ success: true, data: tenant });
  } catch (error) {
    console.error('Tenant fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create/Update tenant (for super-admin)
app.post('/api/tenant', async (req, res) => {
  try {
    const { hotelId, hotelName, logo, currency, language, country, active, theme, subscriptionType } = req.body;

    if (!hotelId) {
      return res.status(400).json({ success: false, error: 'hotelId is required' });
    }

    const result = await db.collection('tenants').updateOne(
      { hotelId },
      { 
        $set: { 
          hotelName, logo, currency, language, country, active, theme, subscriptionType,
          updatedAt: new Date()
        } 
      },
      { upsert: true }
    );

    // Broadcast config update to all devices in this hotel
    broadcast(hotelId, 'settings_update', { hotelName, currency, language, theme });

    res.json({ 
      success: true, 
      message: result.upsertedCount ? 'Tenant created' : 'Tenant updated',
      data: { hotelId, hotelName }
    });
  } catch (error) {
    console.error('Tenant save error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== ROOMS CRUD ====================

app.get('/api/rooms', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const rooms = await db.collection('rooms').find({ hotelId }).sort({ number: 1 }).toArray();
    res.json({ success: true, data: rooms, count: rooms.length });
  } catch (error) {
    console.error('Rooms fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/rooms/available', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const rooms = await db.collection('rooms').find({ hotelId, status: 'Vacant' }).sort({ number: 1 }).toArray();
    res.json({ success: true, data: rooms, count: rooms.length });
  } catch (error) {
    console.error('Available rooms fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/rooms', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { number, type, price, status, guestName, amenities } = req.body;

    if (!number || !type || !price) {
      return res.status(400).json({ success: false, error: 'number, type, and price are required' });
    }

    // Check for duplicate room number in same hotel
    const existing = await db.collection('rooms').findOne({ hotelId, number: parseInt(number) });
    if (existing) {
      return res.status(400).json({ success: false, error: 'Room number already exists' });
    }

    const room = {
      hotelId,
      number: parseInt(number),
      type,
      price: parseFloat(price),
      status: status || 'Vacant',
      guestName: guestName || null,
      amenities: amenities || [],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await db.collection('rooms').insertOne(room);
    room._id = result.insertedId;

    // Broadcast to all devices in this hotel
    broadcast(hotelId, 'room_added', room);

    res.status(201).json({ success: true, message: 'Room added', data: room });
  } catch (error) {
    console.error('Room create error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/rooms/:id', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { id } = req.params;
    const { number, type, price, status, guestName, amenities } = req.body;

    const updateData = {
      updatedAt: new Date(),
      ...(number && { number: parseInt(number) }),
      ...(type && { type }),
      ...(price && { price: parseFloat(price) }),
      ...(status && { status }),
      ...(guestName !== undefined && { guestName }),
      ...(amenities && { amenities })
    };

    const result = await db.collection('rooms').updateOne(
      { _id: new ObjectId(id), hotelId },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: 'Room not found' });
    }

    // Fetch updated room for broadcast
    const updatedRoom = await db.collection('rooms').findOne({ _id: new ObjectId(id) });

    // Broadcast update
    broadcast(hotelId, 'room_updated', updatedRoom);

    res.json({ success: true, message: 'Room updated', data: updatedRoom });
  } catch (error) {
    console.error('Room update error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/rooms/:id', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { id } = req.params;

    const result = await db.collection('rooms').deleteOne({ _id: new ObjectId(id), hotelId });

    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, error: 'Room not found' });
    }

    // Broadcast deletion
    broadcast(hotelId, 'room_deleted', { id, hotelId });

    res.json({ success: true, message: 'Room deleted' });
  } catch (error) {
    console.error('Room delete error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== GUESTS CRUD ====================

app.get('/api/guests', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const guests = await db.collection('guests').find({ hotelId }).sort({ createdAt: -1 }).toArray();
    res.json({ success: true, data: guests, count: guests.length });
  } catch (error) {
    console.error('Guests fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/guests', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { name, email, phone, room, checkIn, checkOut, points, status } = req.body;

    if (!name || !room) {
      return res.status(400).json({ success: false, error: 'name and room are required' });
    }

    const guest = {
      hotelId,
      name,
      email: email || null,
      phone: phone || null,
      room: parseInt(room),
      checkIn: checkIn ? new Date(checkIn) : new Date(),
      checkOut: checkOut ? new Date(checkOut) : null,
      points: points || 0,
      status: status || 'active',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await db.collection('guests').insertOne(guest);
    guest._id = result.insertedId;

    broadcast(hotelId, 'guest_added', guest);

    res.status(201).json({ success: true, message: 'Guest added', data: guest });
  } catch (error) {
    console.error('Guest create error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/guests/:id', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { id } = req.params;
    const { name, email, phone, room, checkIn, checkOut, points, status } = req.body;

    const updateData = {
      updatedAt: new Date(),
      ...(name && { name }),
      ...(email !== undefined && { email }),
      ...(phone !== undefined && { phone }),
      ...(room && { room: parseInt(room) }),
      ...(checkIn && { checkIn: new Date(checkIn) }),
      ...(checkOut !== undefined && { checkOut: checkOut ? new Date(checkOut) : null }),
      ...(points !== undefined && { points: parseInt(points) }),
      ...(status && { status })
    };

    const result = await db.collection('guests').updateOne(
      { _id: new ObjectId(id), hotelId },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: 'Guest not found' });
    }

    const updatedGuest = await db.collection('guests').findOne({ _id: new ObjectId(id) });
    broadcast(hotelId, 'guest_updated', updatedGuest);

    res.json({ success: true, message: 'Guest updated', data: updatedGuest });
  } catch (error) {
    console.error('Guest update error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/guests/:id', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { id } = req.params;

    const result = await db.collection('guests').deleteOne({ _id: new ObjectId(id), hotelId });

    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, error: 'Guest not found' });
    }

    broadcast(hotelId, 'guest_deleted', { id, hotelId });
    res.json({ success: true, message: 'Guest deleted' });
  } catch (error) {
    console.error('Guest delete error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== FOOD MENU CRUD ====================

app.get('/api/food', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const food = await db.collection('food').find({ hotelId }).sort({ name: 1 }).toArray();
    res.json({ success: true, data: food, count: food.length });
  } catch (error) {
    console.error('Food fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/food', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { name, price, category, description, available, image } = req.body;

    if (!name || !price) {
      return res.status(400).json({ success: false, error: 'name and price are required' });
    }

    const item = {
      hotelId,
      name,
      price: parseFloat(price),
      category: category || 'Main Course',
      description: description || '',
      available: available !== false,
      image: image || null,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await db.collection('food').insertOne(item);
    item._id = result.insertedId;

    broadcast(hotelId, 'food_added', item);

    res.status(201).json({ success: true, message: 'Food item added', data: item });
  } catch (error) {
    console.error('Food create error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/food/:id', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { id } = req.params;
    const { name, price, category, description, available, image } = req.body;

    const updateData = {
      updatedAt: new Date(),
      ...(name && { name }),
      ...(price && { price: parseFloat(price) }),
      ...(category && { category }),
      ...(description !== undefined && { description }),
      ...(available !== undefined && { available }),
      ...(image !== undefined && { image })
    };

    const result = await db.collection('food').updateOne(
      { _id: new ObjectId(id), hotelId },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: 'Food item not found' });
    }

    const updatedItem = await db.collection('food').findOne({ _id: new ObjectId(id) });
    broadcast(hotelId, 'food_updated', updatedItem);

    res.json({ success: true, message: 'Food item updated', data: updatedItem });
  } catch (error) {
    console.error('Food update error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/food/:id', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { id } = req.params;

    const result = await db.collection('food').deleteOne({ _id: new ObjectId(id), hotelId });

    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, error: 'Food item not found' });
    }

    broadcast(hotelId, 'food_deleted', { id, hotelId });
    res.json({ success: true, message: 'Food item deleted' });
  } catch (error) {
    console.error('Food delete error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== INVENTORY CRUD ====================

app.get('/api/inventory', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const inventory = await db.collection('inventory').find({ hotelId }).sort({ name: 1 }).toArray();
    res.json({ success: true, data: inventory, count: inventory.length });
  } catch (error) {
    console.error('Inventory fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/inventory', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { name, category, quantity, minStock, price, unit, status } = req.body;

    if (!name || !category || quantity === undefined) {
      return res.status(400).json({ success: false, error: 'name, category, and quantity are required' });
    }

    const item = {
      hotelId,
      name,
      category,
      quantity: parseInt(quantity),
      minStock: parseInt(minStock) || 10,
      price: price ? parseFloat(price) : 0,
      unit: unit || 'pcs',
      status: status || (parseInt(quantity) <= (parseInt(minStock) || 10) ? 'low-stock' : 'in-stock'),
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await db.collection('inventory').insertOne(item);
    item._id = result.insertedId;

    broadcast(hotelId, 'inventory_added', item);

    res.status(201).json({ success: true, message: 'Inventory item added', data: item });
  } catch (error) {
    console.error('Inventory create error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/inventory/:id', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { id } = req.params;
    const { name, category, quantity, minStock, price, unit, status } = req.body;

    const updateData = {
      updatedAt: new Date(),
      ...(name && { name }),
      ...(category && { category }),
      ...(quantity !== undefined && { quantity: parseInt(quantity) }),
      ...(minStock !== undefined && { minStock: parseInt(minStock) }),
      ...(price !== undefined && { price: parseFloat(price) }),
      ...(unit && { unit }),
      ...(status && { status })
    };

    // Auto-update status based on quantity
    if (quantity !== undefined && minStock !== undefined) {
      const qty = parseInt(quantity);
      const min = parseInt(minStock);
      if (qty <= 0) updateData.status = 'out-of-stock';
      else if (qty <= min) updateData.status = 'low-stock';
      else updateData.status = 'in-stock';
    }

    const result = await db.collection('inventory').updateOne(
      { _id: new ObjectId(id), hotelId },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: 'Inventory item not found' });
    }

    const updatedItem = await db.collection('inventory').findOne({ _id: new ObjectId(id) });
    broadcast(hotelId, 'inventory_updated', updatedItem);

    res.json({ success: true, message: 'Inventory item updated', data: updatedItem });
  } catch (error) {
    console.error('Inventory update error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/inventory/:id', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { id } = req.params;

    const result = await db.collection('inventory').deleteOne({ _id: new ObjectId(id), hotelId });

    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, error: 'Inventory item not found' });
    }

    broadcast(hotelId, 'inventory_deleted', { id, hotelId });
    res.json({ success: true, message: 'Inventory item deleted' });
  } catch (error) {
    console.error('Inventory delete error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== SERVICE REQUESTS CRUD ====================

app.get('/api/requests', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { status, priority, department } = req.query;

    let filter = { hotelId };
    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    if (department) filter.department = department;

    const requests = await db.collection('requests').find(filter).sort({ createdAt: -1 }).toArray();
    res.json({ success: true, data: requests, count: requests.length });
  } catch (error) {
    console.error('Requests fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/requests', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { guestName, roomNumber, department, category, description, priority, type, items, totalPrice } = req.body;

    if (!guestName || !roomNumber || !department) {
      return res.status(400).json({ success: false, error: 'guestName, roomNumber, and department are required' });
    }

    const request = {
      hotelId,
      guestName,
      roomNumber: parseInt(roomNumber),
      department,
      category: category || 'General',
      description: description || '',
      priority: priority || 'normal',
      status: 'open',
      type: type || 'service',
      items: items || [],
      totalPrice: totalPrice ? parseFloat(totalPrice) : 0,
      assignedTo: null,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await db.collection('requests').insertOne(request);
    request._id = result.insertedId;

    // Broadcast to all devices in this hotel
    broadcast(hotelId, 'request_added', request);

    // Also send push notification if configured
    // (Implement your push notification logic here)

    res.status(201).json({ success: true, message: 'Request submitted', data: request });
  } catch (error) {
    console.error('Request create error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/requests/:id', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { id } = req.params;
    const { status, priority, assignedTo, notes } = req.body;

    const updateData = {
      updatedAt: new Date(),
      ...(status && { status }),
      ...(priority && { priority }),
      ...(assignedTo !== undefined && { assignedTo }),
      ...(notes && { notes: (notes + '\n[' + new Date().toISOString() + '])') })
    };

    const result = await db.collection('requests').updateOne(
      { _id: new ObjectId(id), hotelId },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: 'Request not found' });
    }

    const updatedRequest = await db.collection('requests').findOne({ _id: new ObjectId(id) });
    broadcast(hotelId, 'request_updated', updatedRequest);

    res.json({ success: true, message: 'Request updated', data: updatedRequest });
  } catch (error) {
    console.error('Request update error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/requests/:id', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { id } = req.params;

    const result = await db.collection('requests').deleteOne({ _id: new ObjectId(id), hotelId });

    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, error: 'Request not found' });
    }

    broadcast(hotelId, 'request_deleted', { id, hotelId });
    res.json({ success: true, message: 'Request deleted' });
  } catch (error) {
    console.error('Request delete error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== BLACKLIST CRUD ====================

app.get('/api/blacklist', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const blacklist = await db.collection('blacklist').find({ hotelId }).sort({ blockedAt: -1 }).toArray();
    res.json({ success: true, data: blacklist, count: blacklist.length });
  } catch (error) {
    console.error('Blacklist fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/blacklist', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { guestName, roomNumber, reason, notes } = req.body;

    if (!guestName || !reason) {
      return res.status(400).json({ success: false, error: 'guestName and reason are required' });
    }

    const entry = {
      hotelId,
      guestName,
      roomNumber: roomNumber ? parseInt(roomNumber) : null,
      reason,
      notes: notes || '',
      blockedBy: req.session?.adminEmail || 'system',
      blockedAt: new Date()
    };

    const result = await db.collection('blacklist').insertOne(entry);
    entry._id = result.insertedId;

    broadcast(hotelId, 'blacklist_added', entry);

    res.status(201).json({ success: true, message: 'Guest blocked', data: entry });
  } catch (error) {
    console.error('Blacklist create error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/blacklist/:id', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { id } = req.params;

    const result = await db.collection('blacklist').deleteOne({ _id: new ObjectId(id), hotelId });

    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, error: 'Entry not found' });
    }

    broadcast(hotelId, 'blacklist_removed', { id, hotelId });
    res.json({ success: true, message: 'Guest unblocked' });
  } catch (error) {
    console.error('Blacklist delete error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== SETTINGS CRUD ====================

app.get('/api/settings', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const settings = await db.collection('settings').findOne({ hotelId });

    if (!settings) {
      // Return default settings
      return res.json({ 
        success: true, 
        data: { 
          hotelId,
          hotelName: 'Crown Plaza Hotel',
          currencySymbol: '$',
          priceFormat: 'symbol-first',
          taxRate: 0,
          wifiSSID: 'Hotel_Guest',
          wifiPassword: 'Welcome123',
          language: 'en',
          theme: { primaryColor: '#667eea' },
          transport: { airport: 30, local: 15 },
          updatedAt: new Date()
        } 
      });
    }

    res.json({ success: true, data: settings });
  } catch (error) {
    console.error('Settings fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/settings', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const settings = req.body;

    const updateData = {
      ...settings,
      hotelId,
      updatedAt: new Date()
    };

    const result = await db.collection('settings').updateOne(
      { hotelId },
      { $set: updateData },
      { upsert: true }
    );

    // Fetch updated settings for broadcast
    const updatedSettings = await db.collection('settings').findOne({ hotelId });

    // Broadcast config update to all devices in this hotel
    broadcast(hotelId, 'settings_update', {
      hotelName: updatedSettings.hotelName,
      currencySymbol: updatedSettings.currencySymbol,
      wifiPassword: updatedSettings.wifiPassword,
      language: updatedSettings.language,
      theme: updatedSettings.theme
    });

    res.json({ success: true, message: 'Settings saved', data: updatedSettings });
  } catch (error) {
    console.error('Settings save error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== DASHBOARD STATS ====================

app.get('/api/dashboard/stats', async (req, res) => {
  try {
    const hotelId = req.hotelId;

    if (!db) {
      return res.status(503).json({ success: false, error: 'Database connecting...' });
    }

    // Parallel queries for performance
    const [rooms, bookings, requests, guests, food, inventory] = await Promise.all([
      db.collection('rooms').find({ hotelId }).toArray(),
      db.collection('bookings').find({ hotelId }).toArray(),
      db.collection('requests').find({ hotelId }).toArray(),
      db.collection('guests').find({ hotelId }).toArray(),
      db.collection('food').find({ hotelId }).toArray(),
      db.collection('inventory').find({ hotelId }).toArray()
    ]);

    const totalRooms = rooms.length;
    const occupiedRooms = rooms.filter(r => r.status === 'Occupied').length;
    const vacantRooms = rooms.filter(r => r.status === 'Vacant').length;
    const totalRevenue = bookings.reduce((sum, b) => sum + (b.totalPrice || 0), 0);
    const openRequests = requests.filter(r => r.status === 'open').length;
    const emergencyRequests = requests.filter(r => r.priority === 'emergency' && r.status !== 'completed').length;

    res.json({
      success: true,
      data: {
        rooms: { total: totalRooms, occupied: occupiedRooms, vacant: vacantRooms },
        bookings: { total: bookings.length, revenue: totalRevenue },
        requests: { total: requests.length, open: openRequests, emergency: emergencyRequests },
        guests: { total: guests.length, active: guests.filter(g => g.status === 'active').length },
        food: { total: food.length },
        inventory: { 
          total: inventory.length, 
          lowStock: inventory.filter(i => i.status === 'low-stock').length,
          outOfStock: inventory.filter(i => i.status === 'out-of-stock').length
        },
        occupancyRate: totalRooms > 0 ? ((occupiedRooms / totalRooms) * 100).toFixed(1) : 0
      }
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== BULK OPERATIONS ====================

app.post('/api/rooms/bulk-update', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { ids, update } = req.body;

    if (!ids || !Array.isArray(ids) || !update) {
      return res.status(400).json({ success: false, error: 'ids array and update object are required' });
    }

    const result = await db.collection('rooms').updateMany(
      { _id: { $in: ids.map(id => new ObjectId(id)) }, hotelId },
      { $set: { ...update, updatedAt: new Date() } }
    );

    broadcast(hotelId, 'rooms_bulk_updated', { ids, update, count: result.modifiedCount });

    res.json({ success: true, message: `${result.modifiedCount} rooms updated`, data: result });
  } catch (error) {
    console.error('Bulk rooms update error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/requests/bulk-update', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { ids, update } = req.body;

    if (!ids || !Array.isArray(ids) || !update) {
      return res.status(400).json({ success: false, error: 'ids array and update object are required' });
    }

    const result = await db.collection('requests').updateMany(
      { _id: { $in: ids.map(id => new ObjectId(id)) }, hotelId },
      { $set: { ...update, updatedAt: new Date() } }
    );

    broadcast(hotelId, 'requests_bulk_updated', { ids, update, count: result.modifiedCount });

    res.json({ success: true, message: `${result.modifiedCount} requests updated`, data: result });
  } catch (error) {
    console.error('Bulk requests update error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== EXPORT ENDPOINTS ====================

app.get('/api/export/rooms', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const rooms = await db.collection('rooms').find({ hotelId }).toArray();

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=rooms-${hotelId}-${new Date().toISOString().split('T')[0]}.json`);
    res.json({ success: true, data: rooms });
  } catch (error) {
    console.error('Export rooms error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/export/requests', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { startDate, endDate } = req.query;

    let filter = { hotelId };
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    const requests = await db.collection('requests').find(filter).toArray();

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=requests-${hotelId}-${new Date().toISOString().split('T')[0]}.json`);
    res.json({ success: true, data: requests });
  } catch (error) {
    console.error('Export requests error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== AUTH ENDPOINTS (Enhanced) ====================

app.post('/api/admin/login', async (req, res) => {
  try {
    const { email, password, hotelId } = req.body;
    console.log('🔐 Admin login attempt:', email, 'for hotel:', hotelId);

    if (!db) {
      return res.status(503).json({ success: false, error: 'Database connecting...' });
    }

    // Check if tenant exists (optional - can create on first login)
    if (hotelId && hotelId !== 'default') {
      const tenant = await db.collection('tenants').findOne({ hotelId });
      if (!tenant) {
        // Auto-create tenant with defaults
        await db.collection('tenants').insertOne({
          hotelId,
          hotelName: 'New Hotel',
          currency: 'USD',
          language: 'en',
          country: 'Unknown',
          active: true,
          theme: 'default',
          subscriptionType: 'basic',
          createdAt: new Date()
        });
      }
    }

    const user = await db.collection('users').findOne({ 
      email: email,
      $or: [{ hotelId }, { hotelId: { $exists: false } }] // Allow global admins
    });

    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    // Check password (in production, use bcrypt)
    if (user.password !== password) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    // Save session with hotel context
    req.session.isAdmin = true;
    req.session.adminEmail = email;
    req.session.hotelId = hotelId || 'default';

    const token = Buffer.from(`${email}:${Date.now()}`).toString('base64');
    console.log('✅ Admin login successful:', email, 'hotel:', hotelId);

    res.json({
      success: true,
      token: token,
      user: { 
        email: user.email, 
        name: user.name || 'Admin', 
        role: user.role || 'admin',
        permissions: user.permissions || []
      },
      hotelId: hotelId || 'default'
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Check session with hotel context
app.get('/api/admin/check-session', (req, res) => {
  if (req.session.isAdmin) {
    res.json({ 
      success: true, 
      isAdmin: true, 
      email: req.session.adminEmail,
      hotelId: req.session.hotelId || 'default'
    });
  } else {
    res.json({ success: false, isAdmin: false });
  }
});

// Logout
app.post('/api/admin/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true, message: 'Logged out' });
});

// ==================== FRONTEND ROUTES ====================

app.get('/admin', (req, res) => {
  // Check if admin is logged in
  if (req.session.isAdmin) {
    res.sendFile(path.join(__dirname, '../inaya-hotel/public/admin.html'));
  } else {
    // Redirect to login or serve public index
    res.sendFile(path.join(__dirname, '../inaya-hotel/public/index.html'));
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../inaya-hotel/public/index.html'));
});

// Serve any static file
app.use(express.static(path.join(__dirname, '../inaya-hotel/public')));

// ==================== ERROR HANDLING ====================

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Endpoint not found' });
});

// ==================== SERVER START ====================

server.listen(PORT, '0.0.0.0', async () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`🌐 URL: http://localhost:${PORT}`);
  console.log(`👑 Admin: http://localhost:${PORT}/admin`);
  console.log(`🔍 Health: http://localhost:${PORT}/api/health`);
  console.log(`📡 Socket.io: Enabled`);
  console.log(`🏨 Multi-tenant: Enabled (hotelId via header/query)`);
  console.log(`\n💡 Frontend should send 'x-hotel-id' header or ?hotelId= query param\n`);

  await connectDB();
});

// ==================== GRACEFUL SHUTDOWN ====================

process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  if (client) await client.close();
  await new Promise(resolve => server.close(resolve));
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  if (client) await client.close();
  await new Promise(resolve => server.close(resolve));
  process.exit(0);
});

// ==================== FRONTEND INTEGRATION NOTES ====================
EOF

// ==================== STAFF CRUD ====================
// Get all staff for a hotel
app.get('/api/staff', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const staff = await db.collection('staff').find({ hotelId }).sort({ createdAt: -1 }).toArray();
    res.json({ success: true, data: staff });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Add new staff
app.post('/api/staff', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { name, role, department, joinDate, shift, status, attendance } = req.body;

    if (!name || !role) {
      return res.status(400).json({ success: false, error: 'Name and role are required' });
    }

    const staff = {
      hotelId,
      name,
      role,
      department: department || 'General',
      joinDate: joinDate ? new Date(joinDate) : new Date(),
      shift: shift || 'morning',
      status: status || 'online',
      attendance: attendance || 'present',
      rating: 5.0,
      tasks: 0,
      leaveRequest: null,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await db.collection('staff').insertOne(staff);
    staff._id = result.insertedId;

    broadcast(hotelId, 'staff_added', staff);
    res.status(201).json({ success: true, data: staff });
  } catch (error) {
    console.error('Staff create error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update staff
app.put('/api/staff/:id', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { id } = req.params;
    const updates = req.body;
    const updateData = { ...updates, updatedAt: new Date() };

    const result = await db.collection('staff').updateOne(
      { _id: new ObjectId(id), hotelId },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: 'Staff not found' });
    }

    const updatedStaff = await db.collection('staff').findOne({ _id: new ObjectId(id) });
    broadcast(hotelId, 'staff_updated', updatedStaff);
    res.json({ success: true, data: updatedStaff });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete staff
app.delete('/api/staff/:id', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { id } = req.params;
    const result = await db.collection('staff').deleteOne({ _id: new ObjectId(id), hotelId });

    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, error: 'Staff not found' });
    }

    broadcast(hotelId, 'staff_deleted', { id, hotelId });
    res.json({ success: true, message: 'Staff deleted' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
