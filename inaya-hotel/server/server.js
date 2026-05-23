require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'crown_plaza_secret_2025';

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());

// ── Static files ──────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../public')));

// ── In-memory data store ─────────────────────────────────────────────────────
const db = {
  users: [
    { id: 'admin_1', name: 'Crown Plaza Admin', email: 'admin@crownplaza.com', passwordHash: bcrypt.hashSync('admin123', 8), role: 'super_admin', hotelId: 'CPH001' },
    { id: 'admin_2', name: 'Front Desk', email: 'frontdesk@crownplaza.com', passwordHash: bcrypt.hashSync('front123', 8), role: 'front_desk', hotelId: 'CPH001' }
  ],
  rooms: Array.from({ length: 50 }, (_, i) => ({
    id: `room_${101 + i}`,
    number: 101 + i,
    type: i % 3 === 0 ? 'Suite' : i % 2 === 0 ? 'Deluxe' : 'Standard',
    status: i % 4 === 0 ? 'Vacant' : i % 3 === 0 ? 'Cleaning' : 'Occupied',
    guestName: i % 4 === 0 ? '' : `Guest ${101 + i}`
  })),
  requests: [
    { id: 'req_1', guestName: 'John Smith', roomNumber: '101', department: 'housekeeping', category: 'Room Cleaning', priority: 'medium', status: 'open', description: 'Need room cleaned', createdAt: new Date().toISOString() },
    { id: 'req_2', guestName: 'Sarah Johnson', roomNumber: '102', department: 'restaurant', category: 'Room Service', priority: 'high', status: 'in_progress', description: 'Dinner order', createdAt: new Date().toISOString() },
    { id: 'req_3', guestName: 'Michael Brown', roomNumber: '103', department: 'maintenance', category: 'AC Not Working', priority: 'high', status: 'open', description: 'AC not cooling', createdAt: new Date().toISOString() }
  ],
  food: [
    { id: 'food_1', name: 'Club Sandwich', price: 12, category: 'Main Course', description: 'Triple decker with fries', available: true },
    { id: 'food_2', name: 'Margherita Pizza', price: 15, category: 'Main Course', description: 'Fresh tomato & mozzarella', available: true },
    { id: 'food_3', name: 'Pasta Alfredo', price: 14, category: 'Main Course', description: 'Creamy white sauce', available: true },
    { id: 'food_4', name: 'Cappuccino', price: 5, category: 'Beverage', description: 'Italian espresso with milk foam', available: true },
    { id: 'food_5', name: 'Caesar Salad', price: 10, category: 'Appetizer', description: 'Romaine, parmesan, croutons', available: true },
    { id: 'food_6', name: 'Chocolate Lava Cake', price: 9, category: 'Dessert', description: 'Warm chocolate cake with vanilla ice cream', available: true },
    { id: 'food_7', name: 'Masala Chai', price: 4, category: 'Beverage', description: 'Spiced Indian tea', available: true },
    { id: 'food_8', name: 'Biryani', price: 18, category: 'Main Course', description: 'Aromatic basmati rice with spices', available: true },
    { id: 'food_9', name: 'Hummus & Pita', price: 8, category: 'Appetizer', description: 'Creamy hummus with warm pita bread', available: true },
    { id: 'food_10', name: 'Mango Lassi', price: 6, category: 'Beverage', description: 'Sweet mango yogurt drink', available: true }
  ],
  inventory: [
    { id: 'inv_1', item: 'Towels', quantity: 150, unit: 'pcs', minStock: 50 },
    { id: 'inv_2', item: 'Linen Sheets', quantity: 80, unit: 'sets', minStock: 30 },
    { id: 'inv_3', item: 'Pillows', quantity: 60, unit: 'pcs', minStock: 20 },
    { id: 'inv_4', item: 'Bathrobes', quantity: 45, unit: 'pcs', minStock: 15 },
    { id: 'inv_5', item: 'Toiletries Kit', quantity: 200, unit: 'pcs', minStock: 80 },
    { id: 'inv_6', item: 'Mineral Water (bottles)', quantity: 300, unit: 'bottles', minStock: 100 },
    { id: 'inv_7', item: 'Coffee Sachets', quantity: 120, unit: 'pcs', minStock: 40 }
  ],
  settings: {
    name: 'Crown Plaza Hotel',
    currencySymbol: '₹',
    priceFormat: 'symbol-first',
    transportPrices: { airport: 500, local: 200 },
    wifiPassword: 'CrownPlaza@2024',
    checkoutTime: '12:00',
    restaurantHours: '6AM-11PM',
    gymHours: '24/7',
    emergencyContact: '+91-800-HOTEL-911',
    hotelId: 'CPH001'
  },
  reviews: [
    { id: 'rev_1', guestName: 'Rahul Sharma', room: 101, overall: 5, cleanliness: 5, staff: 4, recommend: true, comment: 'Excellent stay!', createdAt: new Date().toISOString() }
  ],
  maintenance: [
    { id: 'maint_1', room: 105, task: 'AC Service', date: '2025-01-25', status: 'Scheduled', priority: 'high' },
    { id: 'maint_2', room: 108, task: 'TV Repair', date: '2025-01-26', status: 'Pending', priority: 'medium' }
  ],
  blacklist: [],
  loyalty: [],
  staff: [
    { id: 'staff_1', name: 'Priya (Housekeeping)', completed: 45, pending: 2, rating: 4.8, department: 'housekeeping' },
    { id: 'staff_2', name: 'Rahul (Maintenance)', completed: 32, pending: 5, rating: 4.5, department: 'maintenance' },
    { id: 'staff_3', name: 'Anita (Restaurant)', completed: 28, pending: 1, rating: 4.9, department: 'restaurant' }
  ],
  logs: [
    { id: 'log_1', action: 'System Started', details: 'Crown Plaza Hotel System Online', timestamp: new Date().toLocaleString() }
  ],
  hotels: [
    { hotelId: 'CPH001', name: 'Crown Plaza Hotel', countryCode: 'IN', city: 'Mumbai' }
  ],
  guests: []
};

let nextId = 1000;
const newId = () => `id_${++nextId}`;

// ── Auth middleware ────────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ success: false, error: 'No token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    res.status(401).json({ success: false, error: 'Invalid token' });
  }
}

// ── Health ─────────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ success: true, status: 'OK', timestamp: new Date().toISOString() }));
app.get('/api', (req, res) => res.json({ name: 'Crown Plaza Hotel System', version: '5.0.0', status: 'running' }));

// ── AUTH ───────────────────────────────────────────────────────────────────────
// Admin login: email + password
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ success: false, error: 'Email and password required' });

  const user = db.users.find(u => u.email === email);
  if (!user) return res.status(401).json({ success: false, error: 'Invalid credentials' });

  const valid = bcrypt.compareSync(password, user.passwordHash);
  if (!valid) return res.status(401).json({ success: false, error: 'Invalid credentials' });

  const token = jwt.sign({ userId: user.id, role: user.role, hotelId: user.hotelId }, JWT_SECRET, { expiresIn: '7d' });
  res.json({
    success: true,
    data: { token, role: user.role, hotelId: user.hotelId, hotelName: db.settings.name, name: user.name }
  });
});

// Guest login: name + room number only
app.post('/api/auth/guest-login', (req, res) => {
  const { name, room } = req.body;
  if (!name || !room) return res.status(400).json({ success: false, error: 'Name and room number required' });

  const roomNum = parseInt(room);
  const roomExists = db.rooms.find(r => r.number === roomNum);
  if (!roomExists) return res.status(404).json({ success: false, error: `Room ${room} not found. Valid rooms: 101-150` });

  const guestId = `guest_${Date.now()}`;
  const token = jwt.sign({ userId: guestId, role: 'guest', hotelId: 'CPH001', name, room: roomNum }, JWT_SECRET, { expiresIn: '24h' });

  // Register/update guest
  let guest = db.guests.find(g => g.room === roomNum);
  if (!guest) {
    guest = { id: guestId, name, room: roomNum, type: 'guest', checkedIn: new Date().toISOString() };
    db.guests.push(guest);
  } else {
    guest.name = name;
  }

  db.logs.unshift({ id: newId(), action: 'Guest Login', details: `${name} - Room ${room}`, timestamp: new Date().toLocaleString() });

  res.json({
    success: true,
    data: { token, role: 'guest', hotelId: 'CPH001', hotelName: db.settings.name, name, room: roomNum }
  });
});

// ── ROOMS ─────────────────────────────────────────────────────────────────────
app.get('/api/rooms', authMiddleware, (req, res) => res.json({ success: true, data: db.rooms }));
app.post('/api/rooms', authMiddleware, (req, res) => {
  const room = { id: newId(), ...req.body };
  db.rooms.push(room);
  res.json({ success: true, data: room });
});
app.put('/api/rooms/:id', authMiddleware, (req, res) => {
  const idx = db.rooms.findIndex(r => r.id === req.params.id);
  if (idx < 0) return res.status(404).json({ success: false, error: 'Room not found' });
  db.rooms[idx] = { ...db.rooms[idx], ...req.body };
  res.json({ success: true, data: db.rooms[idx] });
});
app.delete('/api/rooms/:id', authMiddleware, (req, res) => {
  db.rooms = db.rooms.filter(r => r.id !== req.params.id);
  res.json({ success: true });
});

// ── REQUESTS / BOOKINGS ───────────────────────────────────────────────────────
app.get('/api/requests', authMiddleware, (req, res) => res.json({ success: true, data: db.requests }));
app.post('/api/requests', authMiddleware, (req, res) => {
  const req_ = { id: newId(), createdAt: new Date().toISOString(), status: 'open', ...req.body };
  db.requests.unshift(req_);
  res.json({ success: true, data: req_ });
});
app.put('/api/requests/:id', authMiddleware, (req, res) => {
  const idx = db.requests.findIndex(r => r.id === req.params.id);
  if (idx < 0) return res.status(404).json({ success: false, error: 'Request not found' });
  db.requests[idx] = { ...db.requests[idx], ...req.body };
  res.json({ success: true, data: db.requests[idx] });
});
app.delete('/api/requests/:id', authMiddleware, (req, res) => {
  db.requests = db.requests.filter(r => r.id !== req.params.id);
  res.json({ success: true });
});

// ── FOOD MENU ─────────────────────────────────────────────────────────────────
app.get('/api/food', (req, res) => res.json({ success: true, data: db.food }));
app.post('/api/food', authMiddleware, (req, res) => {
  const item = { id: newId(), ...req.body };
  db.food.push(item);
  res.json({ success: true, data: item });
});
app.put('/api/food/:id', authMiddleware, (req, res) => {
  const idx = db.food.findIndex(f => f.id === req.params.id);
  if (idx < 0) return res.status(404).json({ success: false, error: 'Food item not found' });
  db.food[idx] = { ...db.food[idx], ...req.body };
  res.json({ success: true, data: db.food[idx] });
});
app.delete('/api/food/:id', authMiddleware, (req, res) => {
  db.food = db.food.filter(f => f.id !== req.params.id);
  res.json({ success: true });
});

// ── INVENTORY ─────────────────────────────────────────────────────────────────
app.get('/api/inventory', authMiddleware, (req, res) => res.json({ success: true, data: db.inventory }));
app.post('/api/inventory', authMiddleware, (req, res) => {
  const item = { id: newId(), ...req.body };
  db.inventory.push(item);
  res.json({ success: true, data: item });
});
app.put('/api/inventory/:id', authMiddleware, (req, res) => {
  const idx = db.inventory.findIndex(i => i.id === req.params.id);
  if (idx < 0) return res.status(404).json({ success: false, error: 'Item not found' });
  db.inventory[idx] = { ...db.inventory[idx], ...req.body };
  res.json({ success: true, data: db.inventory[idx] });
});
app.delete('/api/inventory/:id', authMiddleware, (req, res) => {
  db.inventory = db.inventory.filter(i => i.id !== req.params.id);
  res.json({ success: true });
});

// ── SETTINGS ──────────────────────────────────────────────────────────────────
app.get('/api/settings', (req, res) => res.json({ success: true, data: db.settings }));
app.put('/api/settings', authMiddleware, (req, res) => {
  db.settings = { ...db.settings, ...req.body };
  res.json({ success: true, data: db.settings });
});

// ── USERS / GUESTS ────────────────────────────────────────────────────────────
app.get('/api/users', authMiddleware, (req, res) => {
  const { room, type } = req.query;
  let list = [...db.guests];
  if (room) list = list.filter(g => String(g.room) === String(room));
  if (type) list = list.filter(g => g.type === type);
  res.json({ success: true, data: list });
});
app.post('/api/users', authMiddleware, (req, res) => {
  const user = { id: newId(), ...req.body };
  db.guests.push(user);
  res.json({ success: true, data: user });
});

// ── REVIEWS ───────────────────────────────────────────────────────────────────
app.get('/api/reviews', authMiddleware, (req, res) => res.json({ success: true, data: db.reviews }));
app.post('/api/reviews', authMiddleware, (req, res) => {
  const review = { id: newId(), createdAt: new Date().toISOString(), ...req.body };
  db.reviews.unshift(review);
  res.json({ success: true, data: review });
});

// ── MAINTENANCE ───────────────────────────────────────────────────────────────
app.get('/api/maintenance', authMiddleware, (req, res) => res.json({ success: true, data: db.maintenance }));
app.post('/api/maintenance', authMiddleware, (req, res) => {
  const task = { id: newId(), status: 'Scheduled', ...req.body };
  db.maintenance.push(task);
  res.json({ success: true, data: task });
});
app.put('/api/maintenance/:id', authMiddleware, (req, res) => {
  const idx = db.maintenance.findIndex(m => m.id === req.params.id);
  if (idx < 0) return res.status(404).json({ success: false, error: 'Task not found' });
  db.maintenance[idx] = { ...db.maintenance[idx], ...req.body };
  res.json({ success: true, data: db.maintenance[idx] });
});
app.delete('/api/maintenance/:id', authMiddleware, (req, res) => {
  db.maintenance = db.maintenance.filter(m => m.id !== req.params.id);
  res.json({ success: true });
});

// ── BLACKLIST ─────────────────────────────────────────────────────────────────
app.get('/api/blacklist', authMiddleware, (req, res) => res.json({ success: true, data: db.blacklist }));
app.post('/api/blacklist', authMiddleware, (req, res) => {
  const item = { id: newId(), date: new Date().toISOString().split('T')[0], ...req.body };
  db.blacklist.push(item);
  res.json({ success: true, data: item });
});
app.delete('/api/blacklist/:id', authMiddleware, (req, res) => {
  db.blacklist = db.blacklist.filter(b => b.id !== req.params.id);
  res.json({ success: true });
});

// ── LOYALTY ───────────────────────────────────────────────────────────────────
app.get('/api/loyalty', authMiddleware, (req, res) => res.json({ success: true, data: db.loyalty }));
app.post('/api/loyalty', authMiddleware, (req, res) => {
  const item = { id: newId(), points: 0, ...req.body };
  db.loyalty.push(item);
  res.json({ success: true, data: item });
});
app.put('/api/loyalty/:id', authMiddleware, (req, res) => {
  const idx = db.loyalty.findIndex(l => l.id === req.params.id);
  if (idx < 0) return res.status(404).json({ success: false, error: 'Not found' });
  db.loyalty[idx] = { ...db.loyalty[idx], ...req.body };
  res.json({ success: true, data: db.loyalty[idx] });
});

// ── STAFF ─────────────────────────────────────────────────────────────────────
app.get('/api/staff', authMiddleware, (req, res) => res.json({ success: true, data: db.staff }));
app.post('/api/staff', authMiddleware, (req, res) => {
  const s = { id: newId(), ...req.body };
  db.staff.push(s);
  res.json({ success: true, data: s });
});
app.put('/api/staff/:id', authMiddleware, (req, res) => {
  const idx = db.staff.findIndex(s => s.id === req.params.id);
  if (idx < 0) return res.status(404).json({ success: false, error: 'Not found' });
  db.staff[idx] = { ...db.staff[idx], ...req.body };
  res.json({ success: true, data: db.staff[idx] });
});

// ── LOGS ──────────────────────────────────────────────────────────────────────
app.get('/api/logs', authMiddleware, (req, res) => res.json({ success: true, data: db.logs }));
app.post('/api/logs', authMiddleware, (req, res) => {
  const log = { id: newId(), timestamp: new Date().toLocaleString(), ...req.body };
  db.logs.unshift(log);
  if (db.logs.length > 200) db.logs.pop();
  res.json({ success: true, data: log });
});

// ── HOTELS ────────────────────────────────────────────────────────────────────
app.get('/api/hotels', (req, res) => res.json({ success: true, data: db.hotels }));

// ── SYNC ──────────────────────────────────────────────────────────────────────
app.get('/api/sync', authMiddleware, (req, res) => res.json({ success: true, data: { synced: true, timestamp: new Date().toISOString() } }));

// ── Catch-all: serve index.html ───────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n👑 Crown Plaza Hotel Server`);
  console.log(`🚀 Port: ${PORT}`);
  console.log(`🏥 Health: http://localhost:${PORT}/api/health`);
  console.log(`🖥️  UI: http://localhost:${PORT}`);
  console.log(`🔐 Admin: admin@crownplaza.com / admin123`);
  console.log(`👤 Guest: Name + Room Number (101-150)\n`);
});
