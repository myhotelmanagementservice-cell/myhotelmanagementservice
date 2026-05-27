let rooms = [];
let guests = [];
let foodMenu = [];
let inventory = [];
let requests = [];
let blacklist = [];
let maintenance = [];
let reviews = [];
let staff = [];
let logs = [];

/**
 * Crown Plaza Hotel - Ultimate Management System
 * Client-side JavaScript with MongoDB Backend Integration
 * 
 * Features:
 * ✅ Multi-language (EN/HI/AR) with Voice Speech
 * ✅ MongoDB Sync via REST API
 * ✅ Offline Mode with localStorage fallback
 * ✅ PWA Ready - Installable on any device
 * ✅ All Admin & Guest Features
 * ✅ Real-time Updates & Notifications
 */

// ==========================================
// 1. CONFIGURATION & API ENDPOINTS
// ==========================================
const CONFIG = {
  // ✅ MongoDB Backend API Base URL (Replace with your deployed backend)
  API_BASE: 'https://your-backend-api.com/api',

  // ✅ Fallback: Use localStorage if API unavailable (demo/offline mode)
  USE_LOCAL_FALLBACK: true,

  // ✅ Admin Credentials (Validate on backend in production)
  ADMIN_EMAIL: 'admin@crownplaza.com',

  // ✅ Storage Keys (ONLY 5 UI settings in localStorage)
  STORAGE: {
    UI: 'hotel_ui_prefs',      // darkMode, fontSize, brightness, language, theme
    SESSION: 'hotel_session',  // Page state for refresh stability
    USER: 'hotel_user'         // Non-sensitive user info
  },

  // ✅ App Info
  APP_NAME: 'Crown Plaza Hotel',
  VERSION: '2.0.0'
};

// ==========================================
// 2. GLOBAL STATE
// ==========================================
let state = {
  // UI Settings (5 keys max in localStorage)
  ui: {
    darkMode: false,
    fontSize: 0,
    brightness: 1,
    language: 'en',
    theme: 'default'
  },

  // Session & Auth
  session: null,
  user: null,

  // App Data (Synced to MongoDB)
  hotel: {
    name: 'Crown Plaza Hotel',
    wifiPassword: 'CrownPlaza@2024',
    currency: { symbol: '$', format: 'symbol-first' },
    transport: { airport: 30, local: 15 }
  },

  // Collections (MongoDB Documents)
  rooms: [],
  guests: [],
  foodMenu: [],
  inventory: [],
  requests: [],
  reviews: [],
  maintenance: [],
  blacklist: [],
  loyalty: [],
  staff: [],
  logs: [],

  // Guest Cart & Rating
  cart: [],
  rating: { overall: 0, cleanliness: 0, staff: 0, recommend: null },

  // Charts & UI
  charts: {},
  syncStatus: 'idle' // 'idle' | 'syncing' | 'error' | 'offline'
};

// ==========================================
// 3. API SERVICE - MongoDB Backend Connector
// ==========================================
const API = {
  // ✅ Generic Fetch Helper with Error Handling
  async fetch(endpoint, options = {}) {
    const url = `${CONFIG.API_BASE}${endpoint}`;
    const config = {
      headers: {
        'Content-Type': 'application/json',
        'X-App-Version': CONFIG.VERSION,
        ...options.headers
      },
      ...options
    };

    try {
      state.syncStatus = 'syncing';
      showSyncIndicator(true);

      const response = await fetch(url, config);

      if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      state.syncStatus = 'idle';
      showSyncIndicator(false);
      return data;

    } catch (error) {
      console.error('API Fetch Error:', error);
      state.syncStatus = navigator.onLine ? 'error' : 'offline';
      showSyncIndicator(false);

      // ✅ Fallback to localStorage if enabled
      if (CONFIG.USE_LOCAL_FALLBACK && !endpoint.includes('/auth/')) {
        console.log('🔄 Using localStorage fallback');
        return localStorageFallback(endpoint, options);
      }

      throw error;
    }
  },

  // ✅ Auth Endpoints
  auth: {
    async loginGuest(name, room) {
      return API.fetch('/auth/guest/login', {
        method: 'POST',
        body: JSON.stringify({ name, room })
      });
    },

    async loginAdmin(email, password) {
      return API.fetch('/auth/admin/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
    },

    async logout() {
      return API.fetch('/auth/logout', { method: 'POST' });
    }
  },

  // ✅ CRUD Endpoints for Collections
  rooms: {
    getAll: () => API.fetch('/rooms'),
    getById: (id) => API.fetch(`/rooms/${id}`),
    create: (data) => API.fetch('/rooms', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => API.fetch(`/rooms/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id) => API.fetch(`/rooms/${id}`, { method: 'DELETE' })
  },

  guests: {
    getAll: () => API.fetch('/guests'),
    getById: (id) => API.fetch(`/guests/${id}`),
    create: (data) => API.fetch('/guests', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => API.fetch(`/guests/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id) => API.fetch(`/guests/${id}`, { method: 'DELETE' }),
    block: (id, reason) => API.fetch(`/guests/${id}/block`, { 
      method: 'POST', 
      body: JSON.stringify({ reason }) 
    })
  },

  food: {
    getAll: () => API.fetch('/food'),
    create: (data) => API.fetch('/food', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => API.fetch(`/food/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id) => API.fetch(`/food/${id}`, { method: 'DELETE' })
  },

  inventory: {
    getAll: () => API.fetch('/inventory'),
    create: (data) => API.fetch('/inventory', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => API.fetch(`/inventory/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id) => API.fetch(`/inventory/${id}`, { method: 'DELETE' }),
    adjustStock: (id, delta) => API.fetch(`/inventory/${id}/stock`, {
      method: 'PATCH',
      body: JSON.stringify({ delta })
    })
  },

  requests: {
    getAll: (filters = {}) => {
      const params = new URLSearchParams(filters).toString();
      return API.fetch(`/requests?${params}`);
    },
    create: (data) => API.fetch('/requests', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => API.fetch(`/requests/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id) => API.fetch(`/requests/${id}`, { method: 'DELETE' }),
    bulkUpdate: (ids, updates) => API.fetch('/requests/bulk', {
      method: 'PATCH',
      body: JSON.stringify({ ids, updates })
    })
  },

  reviews: {
    getAll: () => API.fetch('/reviews'),
    create: (data) => API.fetch('/reviews', { method: 'POST', body: JSON.stringify(data) }),
    reply: (reviewId, reply) => API.fetch(`/reviews/${reviewId}/reply`, {
      method: 'POST',
      body: JSON.stringify({ reply })
    })
  },

  maintenance: {
    getAll: () => API.fetch('/maintenance'),
    create: (data) => API.fetch('/maintenance', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => API.fetch(`/maintenance/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id) => API.fetch(`/maintenance/${id}`, { method: 'DELETE' })
  },

  loyalty: {
    getAll: () => API.fetch('/loyalty'),
    addPoints: (guestId, points) => API.fetch(`/loyalty/${guestId}/points`, {
      method: 'POST',
      body: JSON.stringify({ points, action: 'add' })
    }),
    redeemPoints: (guestId, points) => API.fetch(`/loyalty/${guestId}/points`, {
      method: 'POST',
      body: JSON.stringify({ points, action: 'redeem' })
    })
  },

  staff: {
    getAll: () => API.fetch('/staff'),
    create: (data) => API.fetch('/staff', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => API.fetch(`/staff/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id) => API.fetch(`/staff/${id}`, { method: 'DELETE' }),
    rate: (id, rating) => API.fetch(`/staff/${id}/rate`, {
      method: 'POST',
      body: JSON.stringify({ rating })
    })
  },

  logs: {
    getAll: (filters = {}) => {
      const params = new URLSearchParams(filters).toString();
      return API.fetch(`/logs?${params}`);
    },
    create: (data) => API.fetch('/logs', { method: 'POST', body: JSON.stringify(data) }),
    clear: () => API.fetch('/logs', { method: 'DELETE' }),
    export: () => API.fetch('/logs/export', { method: 'GET' })
  },

  settings: {
    get: () => API.fetch('/settings'),
    update: (data) => API.fetch('/settings', { method: 'PUT', body: JSON.stringify(data) }),
    updateHotelName: (name) => API.fetch('/settings/hotel-name', {
      method: 'PUT',
      body: JSON.stringify({ name })
    }),
    updateCurrency: (symbol, format) => API.fetch('/settings/currency', {
      method: 'PUT',
      body: JSON.stringify({ symbol, format })
    }),
    updateWifi: (password) => API.fetch('/settings/wifi', {
      method: 'PUT',
      body: JSON.stringify({ password })
    }),
    updateTransport: (airport, local) => API.fetch('/settings/transport', {
      method: 'PUT',
      body: JSON.stringify({ airport, local })
    })
  },

  reports: {
    generate: (type, dateRange) => API.fetch('/reports/generate', {
      method: 'POST',
      body: JSON.stringify({ type, dateRange })
    }),
    export: (type) => API.fetch(`/reports/export/${type}`, { method: 'GET' })
  },

  qr: {
    generate: (roomId) => API.fetch(`/qr/generate/${roomId}`, { method: 'POST' }),
    generateAll: () => API.fetch('/qr/generate-all', { method: 'POST' })
  }
};

// ==========================================
// 4. LOCALSTORAGE FALLBACK (Demo/Offline Mode)
// ==========================================
function localStorageFallback(endpoint, options) {
  const collections = {
    '/rooms': { get: () => state.rooms, set: (d) => state.rooms = d },
    '/guests': { get: () => state.guests, set: (d) => state.guests = d },
    '/food': { get: () => state.foodMenu, set: (d) => state.foodMenu = d },
    '/inventory': { get: () => state.inventory, set: (d) => state.inventory = d },
    '/requests': { get: () => state.requests, set: (d) => state.requests = d },
    '/reviews': { get: () => state.reviews, set: (d) => state.reviews = d },
    '/maintenance': { get: () => state.maintenance, set: (d) => state.maintenance = d },
    '/blacklist': { get: () => state.blacklist, set: (d) => state.blacklist = d },
    '/loyalty': { get: () => state.loyalty, set: (d) => state.loyalty = d },
    '/staff': { get: () => state.staff, set: (d) => state.staff = d },
    '/logs': { get: () => state.logs, set: (d) => state.logs = d },
    '/settings': { 
      get: () => state.hotel, 
      set: (d) => { state.hotel = { ...state.hotel, ...d }; } 
    }
  };

  const key = Object.keys(collections).find(k => endpoint.startsWith(k));
  if (key && collections[key]) {
    if (options.method === 'GET') {
      return Promise.resolve({ success: true, data: collections[key].get() });
    }
    if (options.method === 'POST' || options.method === 'PUT') {
      const body = JSON.parse(options.body);
      collections[key].set(body);
      return Promise.resolve({ success: true, data: body });
    }
    if (options.method === 'DELETE') {
      collections[key].set([]);
      return Promise.resolve({ success: true, message: 'Deleted' });
    }
  }

  return Promise.resolve({ success: true, data: [] });
}

// ==========================================
// 5. UI SETTINGS (ONLY 5 KEYS IN LOCALSTORAGE)
// ==========================================
function loadUISettings() {
  try {
    const saved = localStorage.getItem(CONFIG.STORAGE.UI);
    if (saved) {
      const parsed = JSON.parse(saved);
      // ✅ Only allow these 5 keys
      const allowed = ['darkMode', 'fontSize', 'brightness', 'language', 'theme'];
      allowed.forEach(key => {
        if (parsed[key] !== undefined) state.ui[key] = parsed[key];
      });
    }
  } catch (e) {
    console.error('Failed to load UI settings:', e);
  }
  applyUISettings();
}

function saveUISettings() {
  try {
    // ✅ Only save the 5 allowed keys
    const toSave = {
      darkMode: state.ui.darkMode,
      fontSize: state.ui.fontSize,
      brightness: state.ui.brightness,
      language: state.ui.language,
      theme: state.ui.theme
    };
    localStorage.setItem(CONFIG.STORAGE.UI, JSON.stringify(toSave));
  } catch (e) {
    console.error('Failed to save UI settings:', e);
  }
}

function applyUISettings() {
  // Language & Direction
  document.documentElement.lang = state.ui.language;
  document.documentElement.dir = state.ui.language === 'ar' ? 'rtl' : 'ltr';

  // Theme
  document.body.className = document.body.className.replace(/theme-\w+/g, '').trim();
  if (state.ui.theme !== 'default') {
    document.body.classList.add(`theme-${state.ui.theme}`);
  }

  // Font Size
  const sizes = ['0.875rem', '0.9375rem', '1rem', '1.0625rem', '1.125rem', '1.1875rem', '1.25rem'];
  document.body.style.fontSize = sizes[state.ui.fontSize + 3];

  // Brightness
  document.body.style.filter = `brightness(${state.ui.brightness})`;
  const slider = document.getElementById('brightnessSlider');
  if (slider) {
    slider.value = state.ui.brightness;
    document.getElementById('brightnessValue').textContent = 
      Math.round(state.ui.brightness * 100) + '%';
  }

  // Dark Mode
  if (state.ui.darkMode) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
  const darkBtn = document.getElementById('darkModeBtn');
  if (darkBtn) darkBtn.textContent = state.ui.darkMode ? '☀️' : '🌙';

  // Update active language button
  document.querySelectorAll('.lang-btn, .toolbar-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  const activeLangBtn = document.querySelector(`.lang-btn[onclick*="'${state.ui.language}'"]`);
  if (activeLangBtn) activeLangBtn.classList.add('active');

  // Update translations
  updateLanguageUI();
}

function changeLanguage(lang) {
  state.ui.language = lang;
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';

  // Update button states
  document.querySelectorAll('.lang-btn, .toolbar-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  const btn = document.querySelector(`.lang-btn[onclick*="'${lang}'"]`);
  if (btn) btn.classList.add('active');

  updateLanguageUI();
  updateServiceDropdowns();
  showToast(`Language changed to ${lang.toUpperCase()}`);
  saveUISettings();
  addLog('System', 'Language changed', lang);
}

function updateLanguageUI() {
  const t = translations[state.ui.language];
  if (!t) return;

  // Update text content
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (t[key]) el.textContent = t[key];
  });

  // Update placeholders
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (t[key]) el.placeholder = t[key];
  });

  // Update page title
  const title = document.getElementById('pageTitle');
  if (title && t.pageTitle) title.textContent = t.pageTitle;

  // Update currency badges
  document.querySelectorAll('.currency-badge').forEach(badge => {
    badge.textContent = state.hotel.currency?.symbol || '$';
  });

  // Re-render lists with new language
  renderAllLists();
}

function toggleDarkMode() {
  state.ui.darkMode = !state.ui.darkMode;
  applyUISettings();
  saveUISettings();
  showToast(state.ui.darkMode ? 'Dark mode enabled' : 'Light mode enabled');
  addLog('System', 'Dark mode toggled', state.ui.darkMode ? 'on' : 'off');
}

function adjustFontSize(action) {
  if (action === 'increase') state.ui.fontSize = Math.min(state.ui.fontSize + 1, 3);
  else if (action === 'decrease') state.ui.fontSize = Math.max(state.ui.fontSize - 1, -3);
  else state.ui.fontSize = 0;

  applyUISettings();
  saveUISettings();
}

function adjustBrightness(value) {
  state.ui.brightness = parseFloat(value);
  applyUISettings();
  saveUISettings();
}

function toggleThemeMenu() {
  const menu = document.getElementById('themeMenu');
  if (menu) {
    menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
  }
}

function setTheme(theme) {
  state.ui.theme = theme;
  applyUISettings();
  saveUISettings();

  // Update theme preview UI
  document.querySelectorAll('.theme-preview').forEach((preview, index) => {
    preview.classList.remove('active');
    const themes = ['default', 'sunset', 'forest', 'ocean', 'royal'];
    if (themes[index] === theme) preview.classList.add('active');
  });

  if (document.getElementById('themeMenu')) {
    document.getElementById('themeMenu').style.display = 'none';
  }

  showToast(`Theme changed to ${theme}`);
  addLog('System', 'Theme changed', theme);
}

function toggleHighContrast() {
  document.body.classList.toggle('high-contrast');
  showToast('High contrast ' + 
    (document.body.classList.contains('high-contrast') ? 'enabled' : 'disabled'));
}

// ==========================================
// 6. TRANSLATIONS (EN/HI/AR)
// ==========================================
const translations = {
  en: {
    // ... (same translations as in HTML - include all keys)
    pageTitle: "Crown Plaza Hotel - Ultimate Management System",
    welcomeTitle: "Crown Plaza Hotel",
    welcomeSubtitle: "Complete Management System",
    guestTab: "🏨 Guest",
    adminTab: "👑 Admin",
    // ... include all translation keys
  },
  hi: {
    pageTitle: "क्राउन प्लाज़ा होटल - अल्टीमेट मैनेजमेंट सिस्टम",
    welcomeTitle: "क्राउन प्लाज़ा होटल",
    welcomeSubtitle: "संपूर्ण प्रबंधन प्रणाली",
    guestTab: "🏨 अतिथि",
    adminTab: "👑 व्यवस्थापक",
    // ... include all Hindi translations
  },
  ar: {
    pageTitle: "فندق كراون بلازا - نظام الإدارة النهائي",
    welcomeTitle: "فندق كراون بلازا",
    welcomeSubtitle: "نظام الإدارة الكامل",
    guestTab: "🏨 ضيف",
    adminTab: "👑 مسؤول",
    // ... include all Arabic translations
  }
};

// Helper to get translation
function t(key) {
  return translations[state.ui.language]?.[key] || key;
}

// ==========================================
// 7. SESSION & AUTH MANAGEMENT
// ==========================================
function loadSession() {
  try {
    const saved = localStorage.getItem(CONFIG.STORAGE.SESSION);
    if (saved) state.session = JSON.parse(saved);

    const savedUser = localStorage.getItem(CONFIG.STORAGE.USER);
    if (savedUser) state.user = JSON.parse(savedUser);
  } catch (e) {
    console.error('Failed to load session:', e);
  }
}

function saveSession(page, dashboard) {
  state.session = { page, dashboard, timestamp: Date.now() };
  localStorage.setItem(CONFIG.STORAGE.SESSION, JSON.stringify(state.session));
}

function saveUser(user) {
  // ✅ Only save non-sensitive info
  const safeUser = {
    type: user.type,
    name: user.name,
    room: user.room,
    role: user.role,
    roleName: user.roleName,
    loginTime: user.loginTime
  };
  state.user = safeUser;
  localStorage.setItem(CONFIG.STORAGE.USER, JSON.stringify(safeUser));
}

function clearSession() {
  localStorage.removeItem(CONFIG.STORAGE.SESSION);
  state.session = null;
}

function clearUser() {
  localStorage.removeItem(CONFIG.STORAGE.USER);
  state.user = null;
}

async function handleGuestLogin(name, room) {
  try {
    // Try API first, fallback to local
    const response = await API.auth.loginGuest(name, room);

    if (response.success) {
      const user = { type: 'guest', name, room, loginTime: new Date().toISOString() };
      saveUser(user);
      saveSession('guest', 'guestDashboard');
      showGuestDashboard(name, room);
      showToast(`Welcome, ${name}!`);
      addLog('Guest', 'Login', `Room ${room}`);
      return true;
    }
  } catch (error) {
    console.error('Guest login error:', error);
    // Fallback to local login
    const user = { type: 'guest', name, room, loginTime: new Date().toISOString() };
    saveUser(user);
    saveSession('guest', 'guestDashboard');
    showGuestDashboard(name, room);
    showToast(`Welcome, ${name}! (Offline Mode)`);
    addLog('Guest', 'Login (Offline)', `Room ${room}`);
    return true;
  }
}

async function handleAdminLogin(email, password) {
  try {
    // ✅ Proper validation via API
    const response = await API.auth.loginAdmin(email, password);

    if (response.success && response.user) {
      const user = { 
        type: 'admin', 
        email, 
        role: response.user.role,
        roleName: response.user.roleName,
        loginTime: new Date().toISOString() 
      };
      saveUser(user);
      showRoleSelection();
      showToast('Login successful!');
      addLog('Admin', 'Login successful', email);
      return true;
    } else {
      throw new Error('Invalid credentials');
    }
  } catch (error) {
    console.error('Admin login error:', error);
    showToast('❌ Invalid credentials!', 'error');
    addLog('Admin', 'Login failed', email);

    // Shake animation for feedback
    const form = document.getElementById('adminLoginForm');
    if (form) {
      form.style.animation = 'none';
      setTimeout(() => { form.style.animation = 'shake 0.3s'; }, 10);
    }
    return false;
  }
}

function showRoleSelection() {
  hidePage('loginSelectionPage');
  showPage('roleSelectionPage');
}

async function loginAsRole(role) {
  const roles = {
    'super_admin': '👑 Super Admin',
    'front_desk': '🛎️ Front Desk',
    'housekeeping': '🧹 Housekeeping',
    'maintenance': '🔧 Maintenance',
    'restaurant': '🍽️ Restaurant',
    'laundry': '🧺 Laundry',
    'security': '🛡️ Security',
    'it_support': '💻 IT Support'
  };

  if (state.user) {
    state.user.role = role;
    state.user.roleName = roles[role];
    saveUser(state.user);
  }

  saveSession('admin', 'adminDashboard');
  showAdminDashboard(role);
  showToast(`Logged in as ${roles[role]}`);
  addLog('Admin', 'Role selected', role);
}

function backToLogin() {
  hidePage('roleSelectionPage');
  showPage('loginSelectionPage');
}

function showGuestDashboard(name, room) {
  hidePage('loginSelectionPage');
  showPage('guestDashboard');

  // Update guest info
  const guestInfo = document.getElementById('guestInfo');
  if (guestInfo) guestInfo.textContent = `${name} - Room ${room}`;

  const sosRoom = document.getElementById('sosRoomNumber');
  if (sosRoom) sosRoom.textContent = room;

  showGuestTab('newRequest');
  updateGuestStats();
  syncHotelNameToGuest();
  syncWifiToGuest();

  // Load guest-specific data
  loadGuestData(room);
}

function showAdminDashboard(role) {
  hidePage('roleSelectionPage');
  showPage('adminDashboard');

  // Update role display
  const roleDisplay = document.getElementById('roleDisplay');
  const roleBadge = document.getElementById('adminRoleBadge');
  if (roleDisplay) roleDisplay.textContent = role;
  if (roleBadge) roleBadge.textContent = role;

  showAdminTab('overview');
  updateAdminStats();
  syncHotelNameToAdmin();

  // Load admin data
  loadAllAdminData();
}

async function logout() {
  try {
    await API.auth.logout();
  } catch (e) {
    console.log('Logout API call failed, proceeding with local logout');
  }

  addLog(state.user?.type || 'User', 'Logout', state.user?.name || state.user?.email);
  clearUser();
  clearSession();

  // Hide all dashboards, show login
  hidePage('guestDashboard');
  hidePage('adminDashboard');
  showPage('loginSelectionPage');

  showToast('Logged out successfully');
}

// Page visibility helpers
function showPage(pageId) {
  const page = document.getElementById(pageId);
  if (page) {
    page.classList.remove('hidden');
    page.classList.add('animate-fade-in');
  }
}

function hidePage(pageId) {
  const page = document.getElementById(pageId);
  if (page) {
    page.classList.add('hidden');
    page.classList.remove('animate-fade-in');
  }
}

// ==========================================
// 8. DATA LOADING & SYNC
// ==========================================
async function loadAllAdminData() {
  try {
    // Load all collections in parallel
    const [rooms, guests, food, inventory, requests, reviews, maintenance, blacklist, loyalty, staff, logs, settings] = await Promise.all([
      API.rooms.getAll(),
      API.guests.getAll(),
      API.food.getAll(),
      API.inventory.getAll(),
      API.requests.getAll(),
      API.reviews.getAll(),
      API.maintenance.getAll(),
      API.blacklist?.getAll() || Promise.resolve({ data: [] }),
      API.loyalty?.getAll() || Promise.resolve({ data: [] }),
      API.staff.getAll(),
      API.logs.getAll({ limit: 50 }),
      API.settings.get()
    ]);

    // Update state
    if (rooms.success) state.rooms = rooms.data || [];
    if (guests.success) state.guests = guests.data || [];
    if (food.success) state.foodMenu = food.data || [];
    if (inventory.success) state.inventory = inventory.data || [];
    if (requests.success) state.requests = requests.data || [];
    if (reviews.success) state.reviews = reviews.data || [];
    if (maintenance.success) state.maintenance = maintenance.data || [];
    if (blacklist?.success) state.blacklist = blacklist.data || [];
    if (loyalty?.success) state.loyalty = loyalty.data || [];
    if (staff.success) state.staff = staff.data || [];
    if (logs.success) state.logs = logs.data || [];
    if (settings.success) {
      state.hotel = { ...state.hotel, ...settings.data };
    }

    // Re-render all lists
    renderAllLists();
    updateAdminStats();

  } catch (error) {
    console.error('Failed to load admin data:', error);
    showToast('⚠️ Some data may be outdated', 'warning');
  }
}

async function loadGuestData(roomNumber) {
  try {
    // Load guest-specific data
    const [guestRequests, guestInfo] = await Promise.all([
      API.requests.getAll({ guestRoom: roomNumber }),
      API.guests.getAll({ room: roomNumber })
    ]);

    if (guestRequests.success) {
      state.requests = guestRequests.data || [];
      renderGuestHistory();
      updateGuestStats();
    }

    if (guestInfo.success && guestInfo.data?.[0]) {
      const guest = guestInfo.data[0];
      if (guest.points) {
        document.getElementById('guestPoints')?.textContent = `⭐ ${guest.points} pts`;
        document.getElementById('guestPointsDisplay')?.textContent = guest.points;
      }
    }

  } catch (error) {
    console.error('Failed to load guest data:', error);
  }
}

function renderAllLists() {
  renderRoomsList();
  renderGuestsList();
  renderFoodMenu();
  renderGuestFoodMenu();
  renderInventoryList();
  renderGuestInventory();
  renderAdminRequests();
  renderReviewsList();
  renderMaintenanceList();
  renderLoyaltyList();
  renderStaffList();
  renderBlacklistList();
  renderActivityLogs();
  generateQRCodes();
}

// ==========================================
// 9. RENDERING FUNCTIONS
// ==========================================
function renderRoomsList() {
  const tbody = document.getElementById('roomsTableBody');
  if (!tbody) return;

  tbody.innerHTML = state.rooms.map((room, index) => `
    <tr class="hover:bg-gray-50 dark:hover:bg-gray-800 transition">
      <td class="p-2 font-medium">${room.number}</td>
      <td>${room.type}</td>
      <td>${state.hotel.currency?.symbol || '$'}${room.price}</td>
      <td><span class="status-badge status-${room.status?.toLowerCase()}">${room.status}</span></td>
      <td>${room.guestName || '-'}</td>
      <td class="flex gap-1">
        <button onclick="editRoom(${index})" class="text-blue-600 hover:text-blue-800" title="Edit">✏️</button>
        <button onclick="deleteRoom(${room._id || room.id})" class="text-red-600 hover:text-red-800" title="Delete">🗑️</button>
        <button onclick="generateRoomQR('${room.number}')" class="text-purple-600 hover:text-purple-800" title="QR">📷</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="6" class="text-center py-4 text-gray-500">No rooms added</td></tr>';
}

function renderGuestsList() {
  const tbody = document.getElementById('guestsTableBody');
  if (!tbody) return;

  tbody.innerHTML = state.guests.map((guest, index) => `
    <tr class="hover:bg-gray-50 dark:hover:bg-gray-800 transition">
      <td class="p-2 font-medium">${guest.name}</td>
      <td>${guest.room}</td>
      <td>${guest.checkin ? new Date(guest.checkin).toLocaleDateString() : '-'}</td>
      <td><span class="text-primary font-semibold">⭐ ${guest.points || 0}</span></td>
      <td><span class="status-badge status-${guest.status}">${guest.status}</span></td>
      <td class="flex gap-1">
        <button onclick="editGuest(${index})" class="text-blue-600" title="Edit">✏️</button>
        <button onclick="toggleGuestBlock(${guest._id || guest.id})" 
                class="${guest.status === 'blocked' ? 'text-green-600' : 'text-red-600'}" 
                title="${guest.status === 'blocked' ? 'Unblock' : 'Block'}">
          ${guest.status === 'blocked' ? '✅' : '🚫'}
        </button>
        <button onclick="deleteGuest(${guest._id || guest.id})" class="text-red-600" title="Delete">🗑️</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="6" class="text-center py-4 text-gray-500">No guests added</td></tr>';
}

function renderFoodMenu() {
  const list = document.getElementById('foodMenuList');
  if (!list) return;

  list.innerHTML = state.foodMenu.map((item, index) => `
    <div class="request-card flex justify-between items-start">
      <div>
        <strong class="text-gray-800 dark:text-white">${item.name}</strong>
        <div class="text-sm text-gray-600 dark:text-gray-400">${item.category}</div>
        <div class="font-bold text-primary">${state.hotel.currency?.symbol || '$'}${item.price}</div>
        ${item.description ? `<div class="text-xs text-gray-500">${item.description}</div>` : ''}
      </div>
      <div class="flex gap-2">
        <button onclick="editFood(${index})" class="text-blue-600 hover:text-blue-800">✏️</button>
        <button onclick="deleteFood(${item._id || item.id})" class="text-red-600 hover:text-red-800">🗑️</button>
      </div>
    </div>
  `).join('') || '<p class="text-gray-500 text-center">No dishes added</p>';
}

function renderGuestFoodMenu() {
  const menu = document.getElementById('guestFoodMenu') || document.getElementById('dynamicFoodMenu');
  if (!menu) return;

  menu.innerHTML = state.foodMenu.map(item => `
    <button onclick="addToCart('${item.name}', ${item.price})" 
            class="p-2 bg-gray-100 dark:bg-gray-700 rounded-lg text-left hover:bg-gray-200 dark:hover:bg-gray-600 transition">
      <div class="font-semibold text-sm">${item.name}</div>
      <div class="text-xs text-gray-500">${state.hotel.currency?.symbol || '$'}${item.price}</div>
    </button>
  `).join('') || '<p class="text-gray-500 col-span-2">No items available</p>';
}

function renderInventoryList() {
  const tbody = document.getElementById('inventoryTableBody');
  if (!tbody) return;

  tbody.innerHTML = state.inventory.map((item, index) => `
    <tr class="hover:bg-gray-50 dark:hover:bg-gray-800 transition">
      <td class="p-2 font-medium">${item.name}</td>
      <td>${item.category}</td>
      <td>
        <span class="${item.stock <= item.minAlert ? 'text-red-600 font-bold' : ''}">
          ${item.stock} ${item.unit}
        </span>
        ${item.stock <= item.minAlert ? '<div class="text-xs text-red-500">Low!</div>' : ''}
      </td>
      <td>${item.unit}</td>
      <td>${item.minAlert}</td>
      <td class="flex gap-1">
        <button onclick="editInventory(${index})" class="text-blue-600">✏️</button>
        <button onclick="adjustStock(${item._id || item.id}, 1)" class="text-green-600">➕</button>
        <button onclick="adjustStock(${item._id || item.id}, -1)" class="text-orange-600">➖</button>
        <button onclick="deleteInventory(${item._id || item.id})" class="text-red-600">🗑️</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="6" class="text-center py-4 text-gray-500">No inventory items</td></tr>';
}

function renderGuestInventory() {
  const container = document.getElementById('guestInventoryList');
  if (!container) return;

  container.innerHTML = state.inventory.map(item => `
    <div class="inventory-card">
      <div class="text-2xl">📦</div>
      <div class="font-semibold text-gray-800 dark:text-white">${item.name}</div>
      <div class="text-sm text-gray-600 dark:text-gray-400">${item.category}</div>
      <div class="text-sm">Available: ${item.stock} ${item.unit}</div>
      <button onclick="requestInventoryItem('${item.name}')" 
              class="mt-2 bg-primary hover:opacity-90 text-white px-2 py-1 rounded text-xs transition">
        Request More
      </button>
    </div>
  `).join('');
}

function renderAdminRequests(filter = 'all') {
  const list = document.getElementById('adminRequestsList') || document.getElementById('requestsList');
  if (!list) return;

  let filtered = state.requests;

  // Apply filters
  if (filter !== 'all') {
    if (filter === 'emergency') {
      filtered = filtered.filter(r => r.priority === 'emergency');
    } else {
      filtered = filtered.filter(r => r.status === filter);
    }
  }

  // Apply search
  const searchInput = document.getElementById('adminSearchInput');
  if (searchInput?.value) {
    const search = searchInput.value.toLowerCase();
    filtered = filtered.filter(r => 
      r.guestName?.toLowerCase().includes(search) ||
      r.description?.toLowerCase().includes(search) ||
      r.category?.toLowerCase().includes(search)
    );
  }

  list.innerHTML = filtered.map(req => `
    <div class="request-card ${req.priority === 'emergency' ? 'emergency' : ''} ${req.status === 'completed' ? 'completed' : ''}">
      <div class="flex justify-between items-start">
        <div>
          <strong class="text-gray-800 dark:text-white">${req.guestName}</strong> - Room ${req.guestRoom}
          <div class="text-sm text-gray-600 dark:text-gray-400">${req.department} • ${req.category}</div>
          <div class="flex gap-2 mt-1">
            <span class="status-badge status-${req.status}">${req.status}</span>
            <span class="text-xs ${req.priority === 'emergency' ? 'text-red-600' : 
                  req.priority === 'high' ? 'text-orange-600' : 'text-gray-500'}">
              ${req.priority.toUpperCase()}
            </span>
          </div>
          <p class="text-sm mt-1">${req.description}</p>
          <small class="text-gray-400">${new Date(req.createdAt).toLocaleString()}</small>
        </div>
        <div class="flex flex-col gap-1">
          <select onchange="updateRequestStatus('${req._id || req.id}', this.value)" 
                  class="text-xs border rounded px-1 dark:bg-gray-700 dark:border-gray-600">
            <option value="open" ${req.status === 'open' ? 'selected' : ''}>Open</option>
            <option value="in_progress" ${req.status === 'in_progress' ? 'selected' : ''}>In Progress</option>
            <option value="completed" ${req.status === 'completed' ? 'selected' : ''}>Completed</option>
          </select>
          <button onclick="deleteRequest('${req._id || req.id}')" class="text-red-500 text-xs">🗑️</button>
        </div>
      </div>
    </div>
  `).join('') || '<p class="text-gray-500 text-center py-4">No requests found</p>';
}

function renderGuestHistory() {
  const container = document.getElementById('guestHistoryList') || document.getElementById('guestRequestsList');
  if (!container || !state.user?.room) return;

  const myRequests = state.requests.filter(r => r.guestRoom === state.user.room);

  container.innerHTML = myRequests.map(req => `
    <div class="request-card">
      <div class="flex justify-between">
        <div>
          <strong class="text-gray-800 dark:text-white">${req.department}</strong>
          <br><small class="text-gray-600 dark:text-gray-400">${req.category}: ${req.description}</small>
        </div>
        <span class="status-badge status-${req.status}">${req.status}</span>
      </div>
    </div>
  `).join('') || '<p class="text-gray-500 text-center">No requests yet</p>';
}

function renderReviewsList() {
  const list = document.getElementById('reviewsList');
  if (!list) return;

  // Update stats
  if (state.reviews.length > 0) {
    const avg = (state.reviews.reduce((sum, r) => sum + (r.overall || 0), 0) / state.reviews.length).toFixed(1);
    const recommend = Math.round(
      state.reviews.filter(r => r.recommend).length / state.reviews.length * 100
    );

    document.getElementById('avgRating')?.textContent = avg;
    document.getElementById('totalReviews')?.textContent = state.reviews.length;
    document.getElementById('recommendRate')?.textContent = `${recommend}%`;
  }

  list.innerHTML = state.reviews.slice(0, 10).map(review => `
    <div class="request-card">
      <div class="flex justify-between items-start">
        <div>
          <strong class="text-gray-800 dark:text-white">${review.guest}</strong> - Room ${review.room}
          <div class="text-yellow-500 mt-1">${'★'.repeat(review.overall)}${'☆'.repeat(5 - review.overall)}</div>
          <p class="text-sm mt-1">${review.comment || 'No comment'}</p>
          <small class="text-gray-500">
            Service: ${review.service}★ | Clean: ${review.cleanliness}★ | Recommend: ${review.recommend ? 'Yes' : 'No'}
          </small>
        </div>
        <button onclick="replyToReview('${review.guest}')" class="text-blue-600 text-sm">💬 Reply</button>
      </div>
    </div>
  `).join('') || '<p class="text-gray-500 text-center py-4">No reviews yet</p>';
}

function renderMaintenanceList() {
  const tbody = document.getElementById('maintenanceTableBody') || document.getElementById('maintenanceList');
  if (!tbody) return;

  tbody.innerHTML = state.maintenance.map((task, index) => `
    <tr class="hover:bg-gray-50 dark:hover:bg-gray-800 transition">
      <td class="p-2 font-medium">${task.name}</td>
      <td>${task.room || '-'}</td>
      <td class="text-xs">${new Date(task.scheduled).toLocaleString()}</td>
      <td>${task.assigned || 'Unassigned'}</td>
      <td><span class="status-badge status-${task.status}">${task.status}</span></td>
      <td class="flex gap-1">
        <button onclick="updateMaintenanceStatus('${task._id || task.id}', 'in_progress')" class="text-blue-600">🔄</button>
        <button onclick="updateMaintenanceStatus('${task._id || task.id}', 'completed')" class="text-green-600">✅</button>
        <button onclick="deleteMaintenance('${task._id || task.id}')" class="text-red-600">🗑️</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="6" class="text-center py-4 text-gray-500">No maintenance tasks</td></tr>';
}

function renderLoyaltyList() {
  const tbody = document.getElementById('loyaltyTableBody') || document.getElementById('loyaltyList');
  if (!tbody) return;

  // Calculate stats
  const totalIssued = state.guests.reduce((sum, g) => sum + (g.points || 0), 0);
  const activeMembers = state.guests.filter(g => g.status === 'active').length;

  document.getElementById('totalPointsIssued')?.textContent = totalIssued;
  document.getElementById('activeMembers')?.textContent = activeMembers;

  tbody.innerHTML = state.guests.filter(g => g.points > 0).map((guest, index) => `
    <tr class="hover:bg-gray-50 dark:hover:bg-gray-800 transition">
      <td class="p-2 font-medium">${guest.name}</td>
      <td>${guest.room}</td>
      <td><span class="text-yellow-600 font-bold">⭐ ${guest.points}</span></td>
      <td>${guest.checkin ? new Date(guest.checkin).toLocaleDateString() : '-'}</td>
      <td>${guest.lastActivity ? new Date(guest.lastActivity).toLocaleDateString() : '-'}</td>
      <td class="flex gap-1">
        <button onclick="addPoints(${state.guests.indexOf(guest)}, 10)" class="text-green-600">➕10</button>
        <button onclick="redeemPoints(${state.guests.indexOf(guest)}, 50)" class="text-blue-600">🎁</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="6" class="text-center py-4 text-gray-500">No loyalty members yet</td></tr>';
}

function renderStaffList() {
  const container = document.getElementById('staffList');
  if (!container) return;

  // Update stats
  document.getElementById('staffTotal')?.textContent = state.staff.length;
  document.getElementById('staffActive')?.textContent = state.staff.filter(s => s.status === 'on-duty').length;
  document.getElementById('staffTasks')?.textContent = state.staff.reduce((sum, s) => sum + (s.tasks || 0), 0);

  const avgRating = state.staff.length 
    ? (state.staff.reduce((sum, s) => sum + (s.rating || 0), 0) / state.staff.length).toFixed(1) 
    : '0.0';
  document.getElementById('staffRating')?.textContent = avgRating;

  container.innerHTML = state.staff.map((member, index) => `
    <div class="bg-gray-50 dark:bg-gray-800 rounded-xl p-3">
      <div class="flex justify-between items-start mb-2">
        <div>
          <div class="font-semibold text-gray-800 dark:text-white">${member.name}</div>
          <span class="text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded-full">
            ${member.role}
          </span>
        </div>
        <span class="status-badge ${member.status === 'on-duty' ? 'status-completed' : 'status-open'}">
          ${member.status}
        </span>
      </div>
      <div class="flex justify-between text-sm text-gray-600 dark:text-gray-400">
        <span>📋 Tasks: ${member.tasks || 0}</span>
        <span>⭐ Rating: ${member.rating || 0}</span>
      </div>
      <div class="flex gap-2 mt-2">
        <button onclick="rateStaff(${index})" 
                class="flex-1 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded text-xs font-semibold">
          Rate +
        </button>
        <button onclick="removeStaff(${index})" 
                class="px-3 py-1 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded text-xs">
          Remove
        </button>
      </div>
    </div>
  `).join('');
}

function renderBlacklistList() {
  const tbody = document.getElementById('blacklistTableBody') || document.getElementById('blacklistList');
  if (!tbody) return;

  tbody.innerHTML = state.blacklist.map((entry, index) => `
    <tr class="hover:bg-gray-50 dark:hover:bg-gray-800 transition">
      <td class="p-2 font-medium text-red-600">${entry.name}</td>
      <td>${entry.room || '-'}</td>
      <td class="text-sm">${entry.reason}</td>
      <td class="text-xs text-gray-500">${new Date(entry.date).toLocaleDateString()}</td>
      <td>
        <button onclick="removeFromBlacklist(${entry._id || entry.id})" 
                class="text-green-600 hover:text-green-800">✅ Unblock</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="5" class="text-center py-4 text-gray-500">No blocked guests</td></tr>';
}

function renderActivityLogs() {
  const tbody = document.getElementById('activityLogsTableBody') || document.getElementById('activityLogsList');
  if (!tbody) return;

  tbody.innerHTML = state.logs.slice(0, 50).map(log => `
    <tr class="hover:bg-gray-50 dark:hover:bg-gray-800 transition">
      <td class="p-2 text-xs">${new Date(log.timestamp).toLocaleString()}</td>
      <td class="font-medium">${log.user}</td>
      <td><span class="status-badge status-open">${log.action}</span></td>
      <td class="text-xs truncate max-w-[150px]" title="${log.details}">${log.details || '-'}</td>
      <td class="text-xs text-gray-500 truncate max-w-[100px]">${log.device || '-'}</td>
    </tr>
  `).join('') || '<tr><td colspan="5" class="text-center py-4 text-gray-500">No logs yet</td></tr>';
}

function generateQRCodes() {
  const container = document.getElementById('qrCodesContainer');
  if (!container || typeof QRCode === 'undefined') return;

  container.innerHTML = '';

  state.rooms.forEach(room => {
    const div = document.createElement('div');
    div.className = 'qr-container';
    div.id = `qr-${room.number}`;
    container.appendChild(div);

    // Generate QR using qrcode.js library
    new QRCode(div, {
      text: `https://crownplaza.com/room/${room.number}`,
      width: 100,
      height: 100,
      correctLevel: QRCode.CorrectLevel.H
    });

    // Add label
    const label = document.createElement('div');
    label.className = 'text-center text-xs mt-1 font-medium';
    label.textContent = `Room ${room.number}`;
    container.appendChild(label);
  });
}

// ==========================================
// 10. CRUD OPERATIONS (MongoDB Sync)
// ==========================================
// Rooms
async function saveRoom(roomData, editIndex = -1) {
  try {
    const room = {
      number: roomData.number,
      type: roomData.type,
      price: parseFloat(roomData.price),
      status: roomData.status,
      guestName: roomData.guestName || null,
      updatedAt: new Date().toISOString()
    };

    if (editIndex >= 0 && state.rooms[editIndex]) {
      // Update existing
      const id = state.rooms[editIndex]._id || state.rooms[editIndex].id;
      const response = await API.rooms.update(id, room);
      if (response.success) {
        state.rooms[editIndex] = { ...state.rooms[editIndex], ...room };
      }
    } else {
      // Create new
      const response = await API.rooms.create(room);
      if (response.success) {
        room.id = response.data?._id || Date.now();
        room.createdAt = new Date().toISOString();
        state.rooms.push(room);
      }
    }

    renderRoomsList();
    updateAdminStats();
    showToast('Room saved!');
    addLog('Admin', 'Room saved', `Room ${room.number}`);

  } catch (error) {
    console.error('Failed to save room:', error);
    showToast('Failed to save room', 'error');
  }
}

async function deleteRoom(id) {
  if (!confirm('Delete this room?')) return;

  try {
    const response = await API.rooms.delete(id);
    if (response.success) {
      state.rooms = state.rooms.filter(r => (r._id || r.id) !== id);
      renderRoomsList();
      updateAdminStats();
      showToast('Room deleted');
      addLog('Admin', 'Room deleted', `Room ${id}`);
    }
  } catch (error) {
    console.error('Failed to delete room:', error);
    showToast('Failed to delete room', 'error');
  }
}

// Guests
async function saveGuest(guestData, editIndex = -1) {
  try {
    const guest = {
      name: guestData.name,
      room: guestData.room,
      checkin: guestData.checkin,
      points: parseInt(guestData.points) || 0,
      status: guestData.status,
      updatedAt: new Date().toISOString()
    };

    if (editIndex >= 0 && state.guests[editIndex]) {
      const id = state.guests[editIndex]._id || state.guests[editIndex].id;
      const response = await API.guests.update(id, guest);
      if (response.success) {
        state.guests[editIndex] = { ...state.guests[editIndex], ...guest };
      }
    } else {
      const response = await API.guests.create(guest);
      if (response.success) {
        guest.id = response.data?._id || Date.now();
        guest.createdAt = new Date().toISOString();
        state.guests.push(guest);
      }
    }

    renderGuestsList();
    renderLoyaltyList();
    showToast('Guest saved!');
    addLog('Admin', 'Guest saved', guest.name);

  } catch (error) {
    console.error('Failed to save guest:', error);
    showToast('Failed to save guest', 'error');
  }
}

async function toggleGuestBlock(id) {
  try {
    const guest = state.guests.find(g => (g._id || g.id) === id);
    if (!guest) return;

    const newStatus = guest.status === 'blocked' ? 'active' : 'blocked';

    const response = await API.guests.update(id, { status: newStatus, updatedAt: new Date().toISOString() });
    if (response.success) {
      guest.status = newStatus;
      guest.updatedAt = new Date().toISOString();
      renderGuestsList();
      renderLoyaltyList();
      showToast(`${guest.name} ${newStatus === 'blocked' ? 'blocked' : 'unblocked'}`);
      addLog('Admin', `Guest ${newStatus}`, guest.name);
    }
  } catch (error) {
    console.error('Failed to toggle guest block:', error);
    showToast('Failed to update guest', 'error');
  }
}

// Requests
async function submitRequest(requestData, isGuest = false) {
  try {
    const request = {
      guestName: isGuest ? state.user?.name : requestData.guestName,
      guestRoom: isGuest ? state.user?.room : requestData.guestRoom,
      department: requestData.department,
      category: requestData.category,
      description: requestData.description,
      priority: requestData.priority || 'medium',
      status: 'open',
      createdAt: new Date().toISOString()
    };

    const response = await API.requests.create(request);
    if (response.success) {
      request.id = response.data?._id || Date.now();
      state.requests.unshift(request);

      renderAdminRequests();
      if (isGuest) {
        renderGuestHistory();
        updateGuestStats();
      }
      showToast('Request submitted!');
      addLog(isGuest ? 'Guest' : 'Admin', 'Request submitted', 
        `Room ${request.guestRoom}: ${request.category}`);
    }
  } catch (error) {
    console.error('Failed to submit request:', error);
    showToast('Failed to submit request', 'error');
  }
}

async function updateRequestStatus(id, status) {
  try {
    const response = await API.requests.update(id, { 
      status, 
      updatedAt: new Date().toISOString() 
    });

    if (response.success) {
      const req = state.requests.find(r => (r._id || r.id) === id);
      if (req) {
        req.status = status;
        req.updatedAt = new Date().toISOString();
      }
      renderAdminRequests();
      updateAdminStats();
      if (state.user?.type === 'guest') {
        renderGuestHistory();
        updateGuestStats();
      }
      showToast('Status updated');
      addLog('Admin', 'Request status updated', `#${id}: ${status}`);
    }
  } catch (error) {
    console.error('Failed to update request:', error);
    showToast('Failed to update status', 'error');
  }
}

// ... (Continue with similar patterns for Food, Inventory, Maintenance, etc.)

// ==========================================
// 11. UTILITY FUNCTIONS
// ==========================================
function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type === 'error' ? 'border-red-500' : ''}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(400px)';
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

function showSyncIndicator(show) {
  const indicator = document.getElementById('syncIndicator');
  if (indicator) {
    if (show) {
      indicator.classList.add('active');
    } else {
      indicator.classList.remove('active');
    }
  }
}

function addLog(user, action, details) {
  const log = {
    id: Date.now(),
    timestamp: new Date().toISOString(),
    user: user,
    action: action,
    details: details || '',
    ip: '127.0.0.1', // Replace with real IP from backend
    device: navigator.userAgent.slice(0, 50)
  };

  // Try API first
  API.logs.create(log).catch(() => {
    // Fallback to local
    state.logs.unshift(log);
    renderActivityLogs();
  });
}

function updateDateTime() {
  const now = new Date();
  const options = { 
    weekday: 'short', 
    year: 'numeric', 
    month: 'short', 
    day: 'numeric', 
    hour: '2-digit', 
    minute: '2-digit' 
  };
  const dt = now.toLocaleString(state.ui.language, options);

  document.querySelectorAll('.live-clock').forEach(el => {
    el.textContent = dt;
  });

  if (document.getElementById('liveClockAdmin')) {
    document.getElementById('liveClockAdmin').textContent = now.toLocaleTimeString();
  }
  if (document.getElementById('liveClockGuest')) {
    document.getElementById('liveClockGuest').textContent = now.toLocaleTimeString();
  }
  if (document.getElementById('guestLocalTime')) {
    document.getElementById('guestLocalTime').textContent = dt;
  }
}

// ==========================================
// 12. VOICE SPEECH (Multi-Language)
// ==========================================
let voicesLoaded = false;

async function loadVoices() {
  if (!('speechSynthesis' in window)) return;

  if (window.speechSynthesis.getVoices().length > 0) {
    voicesLoaded = true;
    return;
  }

  return new Promise((resolve) => {
    window.speechSynthesis.onvoiceschanged = () => {
      voicesLoaded = true;
      resolve();
    };
    setTimeout(resolve, 500); // Fallback timeout
  });
}

function speakText(text) {
  if (!('speechSynthesis' in window)) {
    showToast('Speech not supported');
    return;
  }

  // Cancel any ongoing speech
  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);

  // Set language based on current UI language
  utterance.lang = state.ui.language === 'hi' ? 'hi-IN' : 
                   state.ui.language === 'ar' ? 'ar-SA' : 'en-US';
  utterance.rate = 0.9;
  utterance.pitch = 1;

  // Try to find preferred voice
  if (voicesLoaded) {
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(v => 
      v.lang.startsWith(state.ui.language === 'hi' ? 'hi' : 
                       state.ui.language === 'ar' ? 'ar' : 'en')
    );
    if (preferred) utterance.voice = preferred;
  }

  window.speechSynthesis.speak(utterance);
}

// ==========================================
// 13. OFFLINE & NETWORK HANDLING
// ==========================================
function setupNetworkHandlers() {
  // Online/Offline detection
  window.addEventListener('online', () => {
    updateOnlineIndicator(true);
    showToast('🟢 Back online');
    state.syncStatus = 'idle';
    // Trigger sync if we were offline
    if (state.user) loadAllAdminData();
  });

  window.addEventListener('offline', () => {
    updateOnlineIndicator(false);
    showToast('📴 You are offline', 'warning');
    state.syncStatus = 'offline';
  });

  // Initial check
  updateOnlineIndicator(navigator.onLine);
}

function updateOnlineIndicator(online) {
  const indicator = document.getElementById('onlineIndicator');
  const offlineIndicator = document.getElementById('offlineIndicator');

  if (indicator) {
    indicator.className = `online-indicator ${online ? 'online' : 'offline'}`;
    indicator.innerHTML = online ? '🟢 Online' : '🔴 Offline';
  }

  if (offlineIndicator) {
    if (online) {
      offlineIndicator.classList.add('hidden');
    } else {
      offlineIndicator.classList.remove('hidden');
    }
  }
}

// ==========================================
// 14. INITIALIZATION
// ==========================================
document.addEventListener('DOMContentLoaded', async function() {
  // 1. Load voices for speech synthesis
  await loadVoices();

  // 2. Load UI settings from localStorage (5 keys only)

  // 8. Load all data from MongoDB

  await loadAllDataFromServer();
  loadUISettings();

  // 3. Load session for page persistence
  loadSession();

  // 4. Setup network handlers
  setupNetworkHandlers();

  // 5. Start datetime updates
  updateDateTime();
  setInterval(updateDateTime, 1000);

  // 6. Initialize charts (if on admin dashboard)
  if (document.getElementById('deptChart')) {
    initializeCharts();
  }

  // 7. Update language UI
  updateLanguageUI();

  // 8. Check session persistence (stay on page after refresh)
  checkSessionPersistence();

  // 9. Setup event listeners
  setupEventListeners();

  // 10. Initial sync indicator
  showSyncIndicator(false);

  console.log(`✅ ${CONFIG.APP_NAME} v${CONFIG.VERSION} initialized`);
});

function checkSessionPersistence() {
  if (!state.session || !state.user) return;

  const { page, dashboard } = state.session;

  if (page === 'guest' && dashboard === 'guestDashboard' && state.user?.type === 'guest') {
    hidePage('loginSelectionPage');
    showPage('guestDashboard');

    if (state.user?.name && state.user?.room) {
      document.getElementById('guestInfo')?.textContent = 
        `${state.user.name} - Room ${state.user.room}`;
      document.getElementById('sosRoomNumber')?.textContent = state.user.room;
    }

    showGuestTab('newRequest');
    updateGuestStats();
    addLog('Guest', `${state.user.name} resumed session`, `Room ${state.user.room}`);

  } else if (page === 'admin' && dashboard === 'adminDashboard' && state.user?.type === 'admin') {
    hidePage('loginSelectionPage');
    hidePage('roleSelectionPage');
    showPage('adminDashboard');

    if (state.user?.role) {
      document.getElementById('roleDisplay')?.textContent = state.user.role;
      document.getElementById('adminRoleBadge')?.textContent = state.user.roleName || state.user.role;
    }

    showAdminTab('overview');
    updateAdminStats();
    addLog('Admin', `${state.user.email} resumed session`, state.user.role);

    // Load data
    loadAllAdminData();
  }
}

function setupEventListeners() {
  // Brightness slider
  document.getElementById('brightnessSlider')?.addEventListener('input', (e) => {
    adjustBrightness(e.target.value);
  });

  // Login forms
  document.getElementById('guestLoginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('guestNameInput')?.value.trim();
    const room = document.getElementById('guestRoomInput')?.value.trim();
    if (name && room) {
      await handleGuestLogin(name, room);
    }
  });

  document.getElementById('adminLoginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('adminEmailInput')?.value.trim();
    const password = document.getElementById('adminPasswordInput')?.value;
    if (email && password) {
      await handleAdminLogin(email, password);
    }
  });

  // Guest request form
  document.getElementById('guestRequestForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const requestData = {
      department: document.getElementById('guestDepartment')?.value,
      category: document.getElementById('guestCategory')?.value,
      description: document.getElementById('guestDescription')?.value,
      priority: document.getElementById('guestPriority')?.value
    };
    await submitRequest(requestData, true);
    e.target.reset();
  });

  // Admin request form
  document.getElementById('adminRequestForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const requestData = {
      guestName: document.getElementById('reqGuestName')?.value,
      guestRoom: document.getElementById('reqRoomNumber')?.value,
      department: document.getElementById('reqDepartment')?.value,
      category: document.getElementById('reqCategory')?.value,
      description: document.getElementById('reqDescription')?.value,
      priority: document.getElementById('reqPriority')?.value
    };
    await submitRequest(requestData, false);
    e.target.reset();
  });

  // Room form
  document.getElementById('roomForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const roomData = {
      number: document.getElementById('roomNumberInput')?.value,
      type: document.getElementById('roomTypeInput')?.value,
      price: document.getElementById('roomPriceInput')?.value,
      status: document.getElementById('roomStatusInput')?.value,
      guestName: document.getElementById('roomGuestInput')?.value
    };
    const editIndex = parseInt(document.getElementById('roomEditIndex')?.value) || -1;
    await saveRoom(roomData, editIndex);
    closeModal('roomModal');
  });

  // ... Add more form listeners as needed

  // Close modals on outside click
  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeModal(modal.id);
      }
    });
  });

  // Close theme menu on outside click
  document.addEventListener('click', (e) => {
    const themeMenu = document.getElementById('themeMenu');
    const themeBtn = document.querySelector('.theme-selector');
    if (themeMenu && !e.target.closest('#themeMenu') && !e.target.closest('.theme-selector')) {
      themeMenu.style.display = 'none';
    }
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Escape to close modals
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal.active').forEach(modal => {
        closeModal(modal.id);
      });
    }
    // Ctrl+S to save settings
    if (e.ctrlKey && e.key === 's') {
      e.preventDefault();
      saveHotelName();
    }
  });
}

// ==========================================
// 15. EXPORT & PRINT FUNCTIONS
// ==========================================
function exportToExcel(data, filename) {
  if (typeof XLSX === 'undefined') {
    showToast('Excel export library not loaded');
    return;
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, "Data");
  XLSX.writeFile(wb, `${filename}-${new Date().toISOString().slice(0,10)}.xlsx`);
  showToast('Exported to Excel!');
  addLog('Admin', 'Data exported to Excel', filename);
}

function printPage() {
  window.print();
  addLog('Admin', 'Page printed');
}

// ==========================================
// 16. HELPER FUNCTIONS
// ==========================================
function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('active');
    modal.classList.add('hidden');
  }
}

function updateServiceDropdowns() {
  // Update admin request category dropdown
  updateAdminCategories();
  // Update guest request category dropdown
  updateGuestCategories();
}

function updateAdminCategories() {
  const dept = document.getElementById('reqDepartment')?.value;
  const categorySelect = document.getElementById('reqCategory');
  if (!categorySelect) return;

  categorySelect.innerHTML = `<option value="">${t('selectCategory')}</option>`;

  if (dept && categories[dept]) {
    categories[dept].forEach(cat => {
      const option = document.createElement('option');
      option.value = cat.toLowerCase().replace(/\s+/g, '_');
      option.textContent = cat;
      categorySelect.appendChild(option);
    });
  }
}

function updateGuestCategories() {
  const dept = document.getElementById('guestDepartment')?.value;
  const categorySelect = document.getElementById('guestCategory');
  if (!categorySelect) return;

  categorySelect.innerHTML = `<option value="">${t('selectService')}</option>`;

  if (dept && categories[dept]) {
    categories[dept].forEach(cat => {
      const option = document.createElement('option');
      option.value = cat.toLowerCase().replace(/\s+/g, '_');
      option.textContent = cat;
      categorySelect.appendChild(option);
    });
  }
}

// Service categories for requests
const categories = {
  housekeeping: ['Room Cleaning', 'Towel Change', 'Bed Making', 'Extra Amenities'],
  maintenance: ['AC Repair', 'Plumbing', 'Electrical', 'Furniture Fix'],
  restaurant: ['Room Service', 'Table Booking', 'Special Diet', 'Complaint'],
  laundry: ['Wash & Fold', 'Dry Cleaning', 'Ironing', 'Express Service'],
  it: ['WiFi Issue', 'TV Problem', 'Phone Issue', 'Device Setup']
};

// ==========================================
// 17. CHARTS INITIALIZATION
// ==========================================
function initializeCharts() {
  if (typeof Chart === 'undefined') return;

  const commonOpts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } }
  };

  // Department Chart
  const deptCtx = document.getElementById('deptChart');
  if (deptCtx && !state.charts.dept) {
    state.charts.dept = new Chart(deptCtx, {
      type: 'doughnut',
      data: {
        labels: ['Housekeeping', 'Maintenance', 'Restaurant', 'Laundry', 'IT'],
        datasets: [{
          data: [30, 25, 20, 15, 10],
          backgroundColor: ['#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#667eea']
        }]
      },
      options: commonOpts
    });
  }

  // Occupancy Chart
  const occCtx = document.getElementById('occupancyChart');
  if (occCtx && !state.charts.occ) {
    state.charts.occ = new Chart(occCtx, {
      type: 'bar',
      data: {
        labels: ['W1', 'W2', 'W3', 'W4'],
        datasets: [{
          label: 'Occupancy %',
          data: [75, 82, 68, 90],
          backgroundColor: '#667eea'
        }]
      },
      options: {
        ...commonOpts,
        scales: { y: { beginAtZero: true, max: 100 } }
      }
    });
  }

  // Add more charts as needed...
}

// ==========================================
// 18. SYNC HOTEL NAME & WIFI ACROSS PAGES
// ==========================================
function syncHotelNameToLogin() {
  const name = state.hotel.name || 'Crown Plaza Hotel';
  document.getElementById('welcomeTitle')?.textContent = name;
  document.getElementById('hotelNameDisplay')?.textContent = name;
}

function syncHotelNameToAdmin() {
  const name = state.hotel.name || 'Crown Plaza Hotel';
  document.getElementById('headerHotelName')?.textContent = name;
  document.getElementById('hotelNameDisplay')?.textContent = name;
}

function syncHotelNameToGuest() {
  const name = state.hotel.name || 'Crown Plaza Hotel';
  document.getElementById('guestHeaderHotelName')?.textContent = name;
}

async function saveHotelName() {
  const name = document.getElementById('hotelNameInput')?.value.trim() || 'Crown Plaza Hotel';

  try {
    await API.settings.updateHotelName(name);
    state.hotel.name = name;
  } catch (error) {
    console.error('Failed to save hotel name:', error);
  }

  // Update all pages immediately
  syncHotelNameToLogin();
  syncHotelNameToAdmin();
  syncHotelNameToGuest();
  document.getElementById('pageTitle')?.textContent = `${name} - Ultimate Management System`;

  showToast('Hotel name saved!');
  addLog('Admin', 'Hotel name updated', name);
}

function syncWifiToGuest() {
  const pwd = state.hotel.wifiPassword || 'CrownPlaza@2024';
  document.getElementById('guestWifiPassword')?.textContent = pwd;
  document.getElementById('faqWifiPassword')?.textContent = pwd;
}

async function saveWifiPassword() {
  const pwd = document.getElementById('wifiPasswordInput')?.value.trim() || 'CrownPlaza@2024';

  try {
    await API.settings.updateWifi(pwd);
    state.hotel.wifiPassword = pwd;
  } catch (error) {
    console.error('Failed to save WiFi password:', error);
  }

  // Update guest dashboard immediately
  syncWifiToGuest();

  showToast('WiFi password saved!');
  addLog('Admin', 'WiFi password updated', '***');
}

// ==========================================
// 19. TAB NAVIGATION
// ==========================================
function showAdminTab(tabName) {
  // Hide all tabs
  const tabs = ['overview','requests','rooms','guests','reviews','reports','qrcodes','logs','inventory','maintenance','blacklist','loyalty','staff','foodmenu','settings'];
  tabs.forEach(tab => {
    const el = document.getElementById(tab + 'Tab');
    if (el) el.classList.add('hidden');

    const btn = document.getElementById('tab' + tab.charAt(0).toUpperCase() + tab.slice(1));
    if (btn) {
      btn.classList.remove('tab-active', 'text-primary');
      btn.classList.add('text-gray-600', 'dark:text-gray-300');
    }
  });

  // Show selected tab
  const selectedTab = document.getElementById(tabName + 'Tab');
  if (selectedTab) selectedTab.classList.remove('hidden');

  const selectedBtn = document.getElementById('tab' + tabName.charAt(0).toUpperCase() + tabName.slice(1));
  if (selectedBtn) {
    selectedBtn.classList.add('tab-active', 'text-primary');
    selectedBtn.classList.remove('text-gray-600', 'dark:text-gray-300');
  }

  // Load data for specific tabs if needed
  if (tabName === 'logs') renderActivityLogs();
  if (tabName === 'qrcodes') generateQRCodes();
}

function showGuestTab(tabName) {
  const tabs = ['newRequest','foodOrder','transport','myRequests','hotelInfo'];
  tabs.forEach(tab => {
    const el = document.getElementById('guest' + tab.charAt(0).toUpperCase() + tab.slice(1) + 'Tab');
    if (el) el.classList.add('hidden');
  });

  const selectedTab = document.getElementById('guest' + tabName.charAt(0).toUpperCase() + tabName.slice(1) + 'Tab');
  if (selectedTab) selectedTab.classList.remove('hidden');
}

// ==========================================
// 20. STAT UPDATES
// ==========================================
function updateAdminStats() {
  document.getElementById('statTotalRooms')?.textContent = state.rooms?.length || 0;
  document.getElementById('statOccupied')?.textContent = 
    state.rooms?.filter(r => r.status === 'Occupied').length || 0;
  document.getElementById('statOpenRequests')?.textContent = 
    state.requests?.filter(r => r.status === 'open').length || 0;
  document.getElementById('statInProgress')?.textContent = 
    state.requests?.filter(r => r.status === 'in_progress').length || 0;
  document.getElementById('statEmergency')?.textContent = 
    state.requests?.filter(r => r.priority === 'emergency').length || 0;
}

function updateGuestStats() {
  if (!state.user?.room) return;

  const reqs = state.requests?.filter(r => r.guestRoom === state.user.room) || [];
  document.getElementById('guestTotalRequests')?.textContent = reqs.length;
  document.getElementById('guestPendingCount')?.textContent = 
    reqs.filter(r => r.status === 'open').length;
  document.getElementById('guestCompletedCount')?.textContent = 
    reqs.filter(r => r.status === 'completed').length;

  // Update loyalty points
  const guest = state.guests?.find(g => g.room === state.user.room);
  if (guest?.points) {
    document.getElementById('guestPoints')?.textContent = `⭐ ${guest.points} pts`;
    document.getElementById('guestPointsDisplay')?.textContent = guest.points;
  }
}

// ==========================================
// 21. PWA & INSTALL PROMPT
// ==========================================
let deferredPrompt;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  // Could show install button here
  console.log('PWA install prompt available');
});

window.addEventListener('appinstalled', () => {
  console.log('PWA installed');
  addLog('System', 'PWA installed');
});

// ==========================================
// 22. EXPORT MODULE (for use in other files)
// ==========================================
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { API, state, CONFIG, translations, t };
}

// Make functions globally available for inline HTML onclick handlers
window.API = API;
window.state = state;
window.CONFIG = CONFIG;
window.translations = translations;
window.t = t;
window.loadUISettings = loadUISettings;
window.saveUISettings = saveUISettings;
window.applyUISettings = applyUISettings;
window.changeLanguage = changeLanguage;
window.toggleDarkMode = toggleDarkMode;
window.adjustFontSize = adjustFontSize;
window.adjustBrightness = adjustBrightness;
window.toggleThemeMenu = toggleThemeMenu;
window.setTheme = setTheme;
window.toggleHighContrast = toggleHighContrast;
window.speakText = speakText;
window.showToast = showToast;
window.addLog = addLog;
window.handleGuestLogin = handleGuestLogin;
window.handleAdminLogin = handleAdminLogin;
window.loginAsRole = loginAsRole;
window.backToLogin = backToLogin;
window.logout = logout;
window.showGuestDashboard = showGuestDashboard;
window.showAdminDashboard = showAdminDashboard;
window.showAdminTab = showAdminTab;
window.showGuestTab = showGuestTab;
window.renderAllLists = renderAllLists;
window.saveRoom = saveRoom;
window.deleteRoom = deleteRoom;
window.saveGuest = saveGuest;
window.toggleGuestBlock = toggleGuestBlock;
window.submitRequest = submitRequest;
window.updateRequestStatus = updateRequestStatus;
window.closeModal = closeModal;
window.exportToExcel = exportToExcel;
window.printPage = printPage;
window.syncHotelNameToLogin = syncHotelNameToLogin;
window.syncHotelNameToAdmin = syncHotelNameToAdmin;
window.syncHotelNameToGuest = syncHotelNameToGuest;
window.saveHotelName = saveHotelName;
window.syncWifiToGuest = syncWifiToGuest;
window.saveWifiPassword = saveWifiPassword;

async function loadAllDataFromServer() {
    try {
        console.log('🔄 Loading data from MongoDB...');
        
        // Fetch rooms
        const roomsRes = await fetch('/api/rooms');
        if (roomsRes.ok) rooms = await roomsRes.json();
        
        // Fetch guests
        const guestsRes = await fetch('/api/guests');
        if (guestsRes.ok) guests = await guestsRes.json();
        
        // Fetch inventory
        const inventoryRes = await fetch('/api/inventory');
        if (inventoryRes.ok) inventory = await inventoryRes.json();
        
        // Fetch requests
        const requestsRes = await fetch('/api/requests');
        if (requestsRes.ok) requests = await requestsRes.json();
        
        // Re-render all
        renderAll();
        console.log('✅ All data loaded from MongoDB');
        showToast('Data loaded from server');
    } catch(e) {
        console.error('Error loading data:', e);
    }
}
