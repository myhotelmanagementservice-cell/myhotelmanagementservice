import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import crypto from "crypto";

const router: IRouter = Router();

// ============ IN-MEMORY DATA STORE ============
interface Room { id: string; number: number; type: string; status: string; guestName: string; }
interface FoodItem { id: string; name: string; price: number; category: string; description?: string; }
interface Booking { id: string; guestName: string; roomNumber: string; department: string; category: string; description?: string; priority: string; status: string; createdAt: string; hotelId?: string; items?: unknown[]; total?: number; }
interface InventoryItem { id: string; item: string; quantity: number; unit: string; minStock: number; }
interface MaintenanceTask { id: string; room: number | string; task: string; date: string; status: string; priority: string; }
interface BlacklistEntry { id: string; name: string; room?: number | string; reason: string; date: string; phone?: string; }
interface LoyaltyEntry { id: string; name: string; room?: number | string; points: number; tier: string; }
interface StaffMember { id: string; name: string; completed: number; pending: number; rating: number; department: string; }
interface User { id: string; name: string; room?: number | string; email?: string; phone?: string; points?: number; type: string; password?: string; }
interface Review { id: string; guestName: string; roomNumber?: number | string; overall: number; cleanliness?: number; staff?: number; recommend?: boolean; comment?: string; createdAt: string; }
interface ActivityLog { id: string; action: string; detail: string; user: string; timestamp: string; }
interface HotelSettings { name: string; currencySymbol: string; priceFormat: string; transportPrices: { airport: number; local: number }; wifiPassword: string; checkoutTime: string; restaurantHours: string; gymHours: string; emergencyContact: string; }
interface Session { userId: string; email: string; role: string; hotelId: string; name?: string; }

const db: {
  rooms: Room[];
  food: FoodItem[];
  requests: Booking[];
  inventory: InventoryItem[];
  maintenance: MaintenanceTask[];
  blacklist: BlacklistEntry[];
  loyalty: LoyaltyEntry[];
  staff: StaffMember[];
  users: User[];
  reviews: Review[];
  logs: ActivityLog[];
  settings: HotelSettings;
  hotels: { hotelId: string; name: string; countryCode: string }[];
  sessions: Map<string, Session>;
} = {
  rooms: Array.from({ length: 50 }, (_, i) => ({
    id: `room_${101 + i}`,
    number: 101 + i,
    type: i % 5 === 0 ? "Presidential" : i % 3 === 0 ? "Suite" : i % 2 === 0 ? "Deluxe" : "Standard",
    status: i % 4 === 0 ? "Vacant" : i % 7 === 0 ? "Cleaning" : i % 9 === 0 ? "Maintenance" : "Occupied",
    guestName: i % 4 === 0 ? "" : `Guest ${101 + i}`,
  })),

  food: [
    { id: "food_1", name: "Burger", price: 12, category: "Main Course", description: "Juicy beef burger with fries" },
    { id: "food_2", name: "Pizza Margherita", price: 15, category: "Main Course", description: "Fresh tomato and mozzarella" },
    { id: "food_3", name: "Pasta Alfredo", price: 14, category: "Main Course", description: "Creamy Alfredo sauce pasta" },
    { id: "food_4", name: "Caesar Salad", price: 10, category: "Appetizer", description: "Fresh greens with parmesan" },
    { id: "food_5", name: "Coffee", price: 4, category: "Beverage", description: "Freshly brewed espresso" },
    { id: "food_6", name: "Chocolate Cake", price: 8, category: "Dessert", description: "Rich chocolate layer cake" },
    { id: "food_7", name: "Club Sandwich", price: 11, category: "Main Course", description: "Triple-decker with chicken" },
    { id: "food_8", name: "Orange Juice", price: 5, category: "Beverage", description: "Fresh squeezed orange juice" },
    { id: "food_9", name: "Spring Rolls", price: 7, category: "Appetizer", description: "Crispy vegetable spring rolls" },
    { id: "food_10", name: "Ice Cream", price: 6, category: "Dessert", description: "3 scoops of premium ice cream" },
  ],

  requests: [
    { id: "req_1", guestName: "John Smith", roomNumber: "101", department: "housekeeping", category: "Room Cleaning", description: "Need room cleaned ASAP", priority: "high", status: "open", createdAt: new Date(Date.now() - 3600000).toISOString(), hotelId: "CPH001" },
    { id: "req_2", guestName: "Sarah Johnson", roomNumber: "102", department: "restaurant", category: "Food Order", description: "Burger and coffee please", priority: "normal", status: "in_progress", createdAt: new Date(Date.now() - 1800000).toISOString(), hotelId: "CPH001" },
    { id: "req_3", guestName: "Michael Brown", roomNumber: "103", department: "maintenance", category: "AC Not Working", description: "Room is too hot", priority: "high", status: "open", createdAt: new Date(Date.now() - 900000).toISOString(), hotelId: "CPH001" },
  ],

  inventory: [
    { id: "inv_1", item: "Towels", quantity: 150, unit: "pcs", minStock: 50 },
    { id: "inv_2", item: "Linen Sheets", quantity: 80, unit: "sets", minStock: 30 },
    { id: "inv_3", item: "Pillows", quantity: 60, unit: "pcs", minStock: 20 },
    { id: "inv_4", item: "Bathrobes", quantity: 45, unit: "pcs", minStock: 15 },
    { id: "inv_5", item: "Toiletries Kit", quantity: 200, unit: "pcs", minStock: 80 },
    { id: "inv_6", item: "Coffee Sachets", quantity: 300, unit: "pcs", minStock: 100 },
    { id: "inv_7", item: "Mineral Water", quantity: 500, unit: "bottles", minStock: 200 },
  ],

  maintenance: [
    { id: "maint_1", room: 105, task: "AC Service", date: new Date(Date.now() + 86400000).toISOString().split("T")[0], status: "Scheduled", priority: "high" },
    { id: "maint_2", room: 108, task: "TV Repair", date: new Date(Date.now() + 172800000).toISOString().split("T")[0], status: "Pending", priority: "medium" },
    { id: "maint_3", room: 112, task: "Plumbing Leak", date: new Date().toISOString().split("T")[0], status: "In Progress", priority: "high" },
  ],

  blacklist: [
    { id: "black_1", name: "Bad Guest", room: 999, reason: "Payment default and property damage", date: "2024-01-10", phone: "9876543210" },
  ],

  loyalty: [
    { id: "loyal_1", name: "John Smith", room: 101, points: 120, tier: "Silver" },
    { id: "loyal_2", name: "Sarah Johnson", room: 102, points: 75, tier: "Bronze" },
    { id: "loyal_3", name: "Michael Brown", room: 103, points: 250, tier: "Gold" },
  ],

  staff: [
    { id: "staff_1", name: "John (Housekeeping)", completed: 45, pending: 2, rating: 4.8, department: "housekeeping" },
    { id: "staff_2", name: "Mike (Maintenance)", completed: 32, pending: 5, rating: 4.5, department: "maintenance" },
    { id: "staff_3", name: "Sarah (Restaurant)", completed: 28, pending: 1, rating: 4.9, department: "restaurant" },
    { id: "staff_4", name: "David (Front Desk)", completed: 56, pending: 3, rating: 4.7, department: "front_desk" },
  ],

  users: [
    { id: "admin_1", name: "Super Admin", email: "admin@crownplaza.com", password: "admin123", type: "admin", room: undefined, points: 0 },
    { id: "admin_2", name: "Front Desk", email: "frontdesk@crownplaza.com", password: "desk123", type: "staff", room: undefined, points: 0 },
    { id: "guest_1", name: "John Smith", room: 101, email: "john@example.com", phone: "+1234567890", points: 120, type: "guest" },
    { id: "guest_2", name: "Sarah Johnson", room: 102, email: "sarah@example.com", phone: "+1234567891", points: 75, type: "guest" },
    { id: "guest_3", name: "Michael Brown", room: 103, email: "michael@example.com", phone: "+1234567892", points: 200, type: "guest" },
  ],

  reviews: [
    { id: "rev_1", guestName: "John Smith", roomNumber: 101, overall: 5, cleanliness: 5, staff: 5, recommend: true, comment: "Excellent service!", createdAt: new Date().toISOString() },
    { id: "rev_2", guestName: "Sarah Johnson", roomNumber: 102, overall: 4, cleanliness: 4, staff: 5, recommend: true, comment: "Great stay, loved the food", createdAt: new Date().toISOString() },
  ],

  logs: [
    { id: "log_1", action: "System Start", detail: "Crown Plaza QMS initialized", user: "System", timestamp: new Date().toISOString() },
    { id: "log_2", action: "Admin Login", detail: "Super Admin logged in", user: "admin@crownplaza.com", timestamp: new Date().toISOString() },
  ],

  settings: {
    name: "Crown Plaza Hotel",
    currencySymbol: "$",
    priceFormat: "symbol-first",
    transportPrices: { airport: 30, local: 15 },
    wifiPassword: "CrownPlaza@2024",
    checkoutTime: "12:00",
    restaurantHours: "6AM-11PM",
    gymHours: "24/7",
    emergencyContact: "+1-800-HOTEL-911",
  },

  hotels: [
    { hotelId: "CPH001", name: "Crown Plaza Hotel - Main", countryCode: "IN" },
    { hotelId: "CPH002", name: "Crown Plaza Resort - Beach", countryCode: "TH" },
    { hotelId: "CPH003", name: "Crown Plaza Business - City", countryCode: "AE" },
  ],

  sessions: new Map(),
};

// ============ HELPERS ============
function generateId(): string {
  return crypto.randomBytes(8).toString("hex");
}

function generateToken(): string {
  return crypto.randomBytes(24).toString("hex");
}

function ok(res: Response, data: unknown) {
  return res.json({ success: true, data });
}

function fail(res: Response, message: string, status = 400) {
  return res.status(status).json({ success: false, error: message });
}

function addLog(action: string, detail: string, user = "System") {
  db.logs.unshift({
    id: generateId(),
    action,
    detail,
    user,
    timestamp: new Date().toISOString(),
  });
  if (db.logs.length > 500) db.logs.splice(400);
}

// ============ AUTH MIDDLEWARE ============
function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return fail(res, "Unauthorized", 401);
  }
  const token = authHeader.split(" ")[1];
  const session = token ? db.sessions.get(token) : null;
  if (!session) {
    return fail(res, "Unauthorized", 401);
  }
  (req as Request & { session: Session }).session = session;
  return next();
}

// ============ AUTH ROUTES ============
router.post("/crown-plaza/auth/login", (req: Request, res: Response) => {
  const { email, password, name, room, hotelId } = req.body as { email?: string; password?: string; name?: string; room?: string | number; hotelId?: string };

  // Guest login (name + room)
  if (name && room && !email) {
    const token = generateToken();
    const session: Session = {
      userId: `guest_${room}`,
      email: `guest_${room}@hotel.com`,
      role: "guest",
      hotelId: hotelId || "CPH001",
      name: String(name),
    };
    db.sessions.set(token, session);

    // Ensure guest in users list
    const exists = db.users.find((u) => u.type === "guest" && u.room === Number(room));
    if (!exists) {
      db.users.push({ id: generateId(), name: String(name), room: Number(room), type: "guest", points: 0 });
    }

    // Get loyalty points
    const loyal = db.loyalty.find((l) => l.name === name);
    const points = loyal?.points || 0;

    addLog("Guest Login", `${name} - Room ${room}`, String(name));

    return ok(res, {
      token,
      role: "guest",
      hotelId: hotelId || "CPH001",
      hotelName: db.settings.name,
      name: String(name),
      room: Number(room),
      points,
    });
  }

  // Admin login (email + password)
  if (email && password) {
    const adminUser = db.users.find(
      (u) => (u.type === "admin" || u.type === "staff") && u.email === email && u.password === password,
    );

    if (!adminUser) {
      return fail(res, "Invalid email or password", 401);
    }

    const token = generateToken();
    const session: Session = {
      userId: adminUser.id,
      email: adminUser.email || "",
      role: adminUser.type === "admin" ? "super_admin" : "staff",
      hotelId: hotelId || "CPH001",
      name: adminUser.name,
    };
    db.sessions.set(token, session);

    addLog("Admin Login", `${adminUser.name} logged in`, adminUser.email || "admin");

    return ok(res, {
      token,
      role: session.role,
      hotelId: session.hotelId,
      hotelName: db.settings.name,
      name: adminUser.name,
    });
  }

  return fail(res, "Invalid login credentials", 401);
});

// ============ PUBLIC ROUTES (no auth needed) ============
router.get("/crown-plaza/settings", (_req: Request, res: Response) => {
  ok(res, db.settings);
});

router.get("/crown-plaza/food", (_req: Request, res: Response) => {
  ok(res, db.food);
});

router.get("/crown-plaza/hotels", (_req: Request, res: Response) => {
  ok(res, db.hotels);
});

router.get("/crown-plaza/hotels/:hotelId", (req: Request, res: Response) => {
  const hotel = db.hotels.find((h) => h.hotelId === req.params.hotelId);
  if (!hotel) return fail(res, "Hotel not found", 404);
  ok(res, hotel);
});

// ============ AUTHENTICATED ROUTES ============

// REQUESTS (bookings / service requests)
router.get("/crown-plaza/requests", authMiddleware, (req: Request, res: Response) => {
  const hotelId = req.headers["x-hotel-id"] as string || "CPH001";
  const items = db.requests.filter((r) => !r.hotelId || r.hotelId === hotelId);
  ok(res, items);
});

router.post("/crown-plaza/requests", authMiddleware, (req: Request, res: Response) => {
  const hotelId = req.headers["x-hotel-id"] as string || "CPH001";
  const newReq: Booking = {
    id: generateId(),
    ...req.body as Omit<Booking, "id" | "createdAt" | "hotelId">,
    hotelId,
    status: req.body.status || "open",
    createdAt: new Date().toISOString(),
  };
  db.requests.unshift(newReq);
  addLog("Request Created", `${newReq.guestName} - ${newReq.category}`, (req as Request & { session?: Session }).session?.name || "System");
  ok(res, newReq);
});

router.put("/crown-plaza/requests/:id", authMiddleware, (req: Request, res: Response) => {
  const idx = db.requests.findIndex((r) => r.id === req.params.id);
  if (idx === -1) return fail(res, "Not found", 404);
  db.requests[idx] = { ...db.requests[idx], ...(req.body as Partial<Booking>) };
  addLog("Request Updated", `ID: ${req.params.id}`, (req as Request & { session?: Session }).session?.name || "System");
  ok(res, db.requests[idx]);
});

router.delete("/crown-plaza/requests/:id", authMiddleware, (req: Request, res: Response) => {
  const idx = db.requests.findIndex((r) => r.id === req.params.id);
  if (idx === -1) return fail(res, "Not found", 404);
  db.requests.splice(idx, 1);
  addLog("Request Deleted", `ID: ${req.params.id}`, (req as Request & { session?: Session }).session?.name || "System");
  ok(res, { deleted: true });
});

// ROOMS
router.get("/crown-plaza/rooms", authMiddleware, (_req: Request, res: Response) => {
  ok(res, db.rooms);
});

router.post("/crown-plaza/rooms", authMiddleware, (req: Request, res: Response) => {
  const newRoom: Room = { id: generateId(), ...req.body as Omit<Room, "id"> };
  db.rooms.push(newRoom);
  addLog("Room Added", `Room #${newRoom.number}`, (req as Request & { session?: Session }).session?.name || "System");
  ok(res, newRoom);
});

router.put("/crown-plaza/rooms/:id", authMiddleware, (req: Request, res: Response) => {
  const idx = db.rooms.findIndex((r) => r.id === req.params.id);
  if (idx === -1) return fail(res, "Not found", 404);
  db.rooms[idx] = { ...db.rooms[idx], ...(req.body as Partial<Room>) };
  addLog("Room Updated", `Room #${db.rooms[idx].number}`, (req as Request & { session?: Session }).session?.name || "System");
  ok(res, db.rooms[idx]);
});

router.delete("/crown-plaza/rooms/:id", authMiddleware, (req: Request, res: Response) => {
  const idx = db.rooms.findIndex((r) => r.id === req.params.id);
  if (idx === -1) return fail(res, "Not found", 404);
  const room = db.rooms[idx];
  db.rooms.splice(idx, 1);
  addLog("Room Deleted", `Room #${room.number}`, (req as Request & { session?: Session }).session?.name || "System");
  ok(res, { deleted: true });
});

// FOOD MENU
router.post("/crown-plaza/food", authMiddleware, (req: Request, res: Response) => {
  const newItem: FoodItem = { id: generateId(), ...req.body as Omit<FoodItem, "id"> };
  db.food.push(newItem);
  addLog("Food Added", newItem.name, (req as Request & { session?: Session }).session?.name || "System");
  ok(res, newItem);
});

router.put("/crown-plaza/food/:id", authMiddleware, (req: Request, res: Response) => {
  const idx = db.food.findIndex((f) => f.id === req.params.id);
  if (idx === -1) return fail(res, "Not found", 404);
  db.food[idx] = { ...db.food[idx], ...(req.body as Partial<FoodItem>) };
  addLog("Food Updated", db.food[idx].name, (req as Request & { session?: Session }).session?.name || "System");
  ok(res, db.food[idx]);
});

router.delete("/crown-plaza/food/:id", authMiddleware, (req: Request, res: Response) => {
  const idx = db.food.findIndex((f) => f.id === req.params.id);
  if (idx === -1) return fail(res, "Not found", 404);
  const item = db.food[idx];
  db.food.splice(idx, 1);
  addLog("Food Deleted", item.name, (req as Request & { session?: Session }).session?.name || "System");
  ok(res, { deleted: true });
});

// INVENTORY
router.get("/crown-plaza/inventory", authMiddleware, (_req: Request, res: Response) => {
  ok(res, db.inventory);
});

router.post("/crown-plaza/inventory", authMiddleware, (req: Request, res: Response) => {
  const newItem: InventoryItem = { id: generateId(), ...req.body as Omit<InventoryItem, "id"> };
  db.inventory.push(newItem);
  addLog("Inventory Added", newItem.item, (req as Request & { session?: Session }).session?.name || "System");
  ok(res, newItem);
});

router.put("/crown-plaza/inventory/:id", authMiddleware, (req: Request, res: Response) => {
  const idx = db.inventory.findIndex((i) => i.id === req.params.id);
  if (idx === -1) return fail(res, "Not found", 404);
  db.inventory[idx] = { ...db.inventory[idx], ...(req.body as Partial<InventoryItem>) };
  ok(res, db.inventory[idx]);
});

router.delete("/crown-plaza/inventory/:id", authMiddleware, (req: Request, res: Response) => {
  const idx = db.inventory.findIndex((i) => i.id === req.params.id);
  if (idx === -1) return fail(res, "Not found", 404);
  db.inventory.splice(idx, 1);
  addLog("Inventory Deleted", `ID: ${req.params.id}`, (req as Request & { session?: Session }).session?.name || "System");
  ok(res, { deleted: true });
});

// USERS
router.get("/crown-plaza/users", authMiddleware, (req: Request, res: Response) => {
  const { room, type } = req.query as { room?: string; type?: string };
  let users = db.users.filter((u) => u.type === "guest");
  if (room) users = users.filter((u) => u.room === Number(room));
  if (type) users = users.filter((u) => u.type === type);
  const safeUsers = users.map(({ password: _p, ...u }) => u);
  ok(res, safeUsers);
});

router.post("/crown-plaza/users", authMiddleware, (req: Request, res: Response) => {
  const newUser: User = { id: generateId(), ...req.body as Omit<User, "id"> };
  db.users.push(newUser);
  addLog("User Added", newUser.name, (req as Request & { session?: Session }).session?.name || "System");
  const { password: _p, ...safeUser } = newUser;
  ok(res, safeUser);
});

// SETTINGS
router.put("/crown-plaza/settings", authMiddleware, (req: Request, res: Response) => {
  db.settings = { ...db.settings, ...(req.body as Partial<HotelSettings>) };
  addLog("Settings Updated", "Hotel settings changed", (req as Request & { session?: Session }).session?.name || "System");
  ok(res, db.settings);
});

// REVIEWS
router.get("/crown-plaza/reviews", authMiddleware, (_req: Request, res: Response) => {
  ok(res, db.reviews);
});

router.post("/crown-plaza/reviews", authMiddleware, (req: Request, res: Response) => {
  const newReview: Review = {
    id: generateId(),
    ...req.body as Omit<Review, "id" | "createdAt">,
    createdAt: new Date().toISOString(),
  };
  db.reviews.unshift(newReview);
  addLog("Review Submitted", `Rating: ${newReview.overall}/5 by ${newReview.guestName}`, newReview.guestName);
  ok(res, newReview);
});

// MAINTENANCE
router.get("/crown-plaza/maintenance", authMiddleware, (_req: Request, res: Response) => {
  ok(res, db.maintenance);
});

router.post("/crown-plaza/maintenance", authMiddleware, (req: Request, res: Response) => {
  const newTask: MaintenanceTask = { id: generateId(), ...req.body as Omit<MaintenanceTask, "id"> };
  db.maintenance.push(newTask);
  addLog("Maintenance Scheduled", newTask.task, (req as Request & { session?: Session }).session?.name || "System");
  ok(res, newTask);
});

router.put("/crown-plaza/maintenance/:id", authMiddleware, (req: Request, res: Response) => {
  const idx = db.maintenance.findIndex((m) => m.id === req.params.id);
  if (idx === -1) return fail(res, "Not found", 404);
  db.maintenance[idx] = { ...db.maintenance[idx], ...(req.body as Partial<MaintenanceTask>) };
  ok(res, db.maintenance[idx]);
});

router.delete("/crown-plaza/maintenance/:id", authMiddleware, (req: Request, res: Response) => {
  const idx = db.maintenance.findIndex((m) => m.id === req.params.id);
  if (idx === -1) return fail(res, "Not found", 404);
  db.maintenance.splice(idx, 1);
  ok(res, { deleted: true });
});

// BLACKLIST
router.get("/crown-plaza/blacklist", authMiddleware, (_req: Request, res: Response) => {
  ok(res, db.blacklist);
});

router.post("/crown-plaza/blacklist", authMiddleware, (req: Request, res: Response) => {
  const newEntry: BlacklistEntry = { id: generateId(), ...req.body as Omit<BlacklistEntry, "id"> };
  db.blacklist.push(newEntry);
  addLog("Guest Blacklisted", newEntry.name, (req as Request & { session?: Session }).session?.name || "System");
  ok(res, newEntry);
});

router.delete("/crown-plaza/blacklist/:id", authMiddleware, (req: Request, res: Response) => {
  const idx = db.blacklist.findIndex((b) => b.id === req.params.id);
  if (idx === -1) return fail(res, "Not found", 404);
  db.blacklist.splice(idx, 1);
  addLog("Removed from Blacklist", `ID: ${req.params.id}`, (req as Request & { session?: Session }).session?.name || "System");
  ok(res, { deleted: true });
});

// LOYALTY
router.get("/crown-plaza/loyalty", authMiddleware, (_req: Request, res: Response) => {
  ok(res, db.loyalty);
});

router.post("/crown-plaza/loyalty", authMiddleware, (req: Request, res: Response) => {
  const { name, room, points = 10 } = req.body as { name: string; room?: number; points?: number };
  let entry = db.loyalty.find((l) => l.name === name);
  if (entry) {
    entry.points += points;
  } else {
    entry = { id: generateId(), name, room: room || 0, points, tier: "Bronze" };
    db.loyalty.push(entry);
  }
  // Update tier
  entry.tier = entry.points >= 500 ? "Platinum" : entry.points >= 200 ? "Gold" : entry.points >= 100 ? "Silver" : "Bronze";
  addLog("Loyalty Points Added", `+${points} for ${name}`, (req as Request & { session?: Session }).session?.name || "System");
  ok(res, entry);
});

router.put("/crown-plaza/loyalty/:id", authMiddleware, (req: Request, res: Response) => {
  const idx = db.loyalty.findIndex((l) => l.id === req.params.id);
  if (idx === -1) return fail(res, "Not found", 404);
  db.loyalty[idx] = { ...db.loyalty[idx], ...(req.body as Partial<LoyaltyEntry>) };
  ok(res, db.loyalty[idx]);
});

// STAFF
router.get("/crown-plaza/staff", authMiddleware, (_req: Request, res: Response) => {
  ok(res, db.staff);
});

router.post("/crown-plaza/staff", authMiddleware, (req: Request, res: Response) => {
  const newStaff: StaffMember = { id: generateId(), ...req.body as Omit<StaffMember, "id"> };
  db.staff.push(newStaff);
  ok(res, newStaff);
});

router.put("/crown-plaza/staff/:id", authMiddleware, (req: Request, res: Response) => {
  const idx = db.staff.findIndex((s) => s.id === req.params.id);
  if (idx === -1) return fail(res, "Not found", 404);
  db.staff[idx] = { ...db.staff[idx], ...(req.body as Partial<StaffMember>) };
  ok(res, db.staff[idx]);
});

// LOGS
router.get("/crown-plaza/logs", authMiddleware, (_req: Request, res: Response) => {
  ok(res, db.logs.slice(0, 100));
});

// SYNC
router.get("/crown-plaza/sync", authMiddleware, (_req: Request, res: Response) => {
  ok(res, { status: "synced", timestamp: new Date().toISOString() });
});

export default router;
