// ============ MULTI-HOTEL CONFIGURATION ============
const API_BASE_URL = '/api';

// Get current hotelId from localStorage
function getCurrentHotelId() {
    return localStorage.getItem('hotelId') || 'CPH001';
}

// Set current hotelId
function setCurrentHotelId(hotelId) {
    localStorage.setItem('hotelId', hotelId);
    // Reload data for new hotel
    loadAllDataFromBackend();
}

// Enhanced API call with hotelId header
async function apiCall(endpoint, method = 'GET', data = null) {
    const options = {
        method: method,
        headers: {
            'Content-Type': 'application/json',
            'X-Hotel-Id': getCurrentHotelId()
        }
    };
    if (data) options.body = JSON.stringify(data);
    try {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, options);
        return await response.json();
    } catch (error) {
        console.error(`API Error (${endpoint}):`, error);
        return { success: false, error: error.message };
    }
}

// Login function that saves hotelId
async function loginUser(email, password, hotelId) {
    const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, hotelId })
    });
    const result = await response.json();
    if (result.success) {
        localStorage.setItem('token', result.data.token);
        localStorage.setItem('hotelId', result.data.hotelId);
        localStorage.setItem('hotelName', result.data.hotelName);
        localStorage.setItem('role', result.data.role);
        return true;
    }
    return false;
}

// Get all hotels list for hotel switching
async function getHotelsList() {
    const response = await apiCall('/hotels');
    return response.success ? response.data : [];
}

// Render hotel switcher in UI
function renderHotelSwitcher() {
    const currentHotelId = getCurrentHotelId();
    const hotelName = localStorage.getItem('hotelName') || 'Crown Plaza';

    // Add hotel selector to header if not exists
    let hotelSelector = document.getElementById('hotelSelector');
    if (!hotelSelector) {
        const header = document.querySelector('header .flex.justify-between');
        if (header) {
            const selectorHtml = `
                <div id="hotelSelector" class="relative">
                    <button onclick="toggleHotelMenu()" class="bg-white/20 hover:bg-white/30 px-3 py-1 rounded-lg text-sm flex items-center gap-2">
                        🏨 <span id="currentHotelName">${hotelName}</span> ▼
                    </button>
                    <div id="hotelMenu" class="hidden absolute top-full right-0 mt-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg z-50 min-w-[200px]">
                        <div id="hotelList" class="p-2"></div>
                    </div>
                </div>
            `;
            header.insertAdjacentHTML('beforeend', selectorHtml);
        }
    }
}

async function toggleHotelMenu() {
    const menu = document.getElementById('hotelMenu');
    if (menu.classList.contains('hidden')) {
        const hotels = await getHotelsList();
        const listHtml = hotels.map(hotel => `
            <button onclick="switchHotel('${hotel.hotelId}')" class="w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-sm">
                🏨 ${hotel.name} (${hotel.countryCode})
            </button>
        `).join('');
        document.getElementById('hotelList').innerHTML = listHtml || '<div class="px-3 py-2 text-sm">No hotels</div>';
        menu.classList.remove('hidden');
    } else {
        menu.classList.add('hidden');
    }
}

async function switchHotel(hotelId) {
    const hotel = await apiCall(`/hotels/${hotelId}`);
    if (hotel.success && hotel.data) {
        setCurrentHotelId(hotelId);
        localStorage.setItem('hotelName', hotel.data.name);
        document.getElementById('currentHotelName').innerText = hotel.data.name;
        document.getElementById('hotelMenu').classList.add('hidden');
        showToast(`Switched to ${hotel.data.name}`, 'success');
        // Reload all data
        await loadAllDataFromBackend();
        if (typeof refreshAllUI === 'function') refreshAllUI();
    }
}

// Enhanced loadAllDataFromBackend (already uses apiCall with hotelId)
// Your existing loadAllDataFromBackend function already works with the new apiCall!

// Add to window for global access
window.switchHotel = switchHotel;
window.toggleHotelMenu = toggleHotelMenu;
window.getCurrentHotelId = getCurrentHotelId;
window.setCurrentHotelId = setCurrentHotelId;

console.log('✅ Multi-hotel support enabled');
// Translations dictionary
const translations = {
    en: {
        connectionError: "Connection error! Using local data.",
        offlineModeActive: "Offline mode - using local storage",
        backendConnected: "Connected to server!",
        welcomeBack: "Welcome back!",
        guestWelcome: "Welcome",
        adminWelcome: "Welcome",
        loginSuccess: "Login successful",
        invalidCredentials: "Invalid credentials",
        languageChanged: "Language changed to "
    },
    hi: {
        connectionError: "कनेक्शन त्रुटि! स्थानीय डेटा उपयोग हो रहा है।",
        offlineModeActive: "ऑफलाइन मोड - स्थानीय स्टोरेज उपयोग हो रहा है",
        backendConnected: "सर्वर से कनेक्ट हो गया!",
        welcomeBack: "वापसी पर स्वागत है!",
        guestWelcome: "स्वागत है",
        adminWelcome: "स्वागत है",
        loginSuccess: "लॉगिन सफल",
        invalidCredentials: "अमान्य क्रेडेंशियल",
        languageChanged: "भाषा बदलकर हुई "
    },
    ar: {
        connectionError: "خطأ في الاتصال! استخدام البيانات المحلية.",
        offlineModeActive: "وضع عدم الاتصال - استخدام التخزين المحلي",
        backendConnected: "متصل بالخادم!",
        welcomeBack: "مرحبًا بعودتك!",
        guestWelcome: "مرحبًا",
        adminWelcome: "مرحبًا",
        loginSuccess: "تسجيل الدخول ناجح",
        invalidCredentials: "بيانات الاعتماد غير صالحة",
        languageChanged: "تم تغيير اللغة إلى "
    }
};
// ============ TRANSLATIONS ============

// ============ GLOBAL CONFIG & DATA ============
let timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
let currentLanguage = 'en';
let offlineMode = false;
let isClockedIn = false;
let currentAdminRole = 'super_admin';
let currentGuest = null;
let currentAdminFilter = 'all';
let currentPage = 0;
let isLoading = false;
let hasMore = true;
let selectedRequests = new Set();
let adminSearchQuery = '';
let cart = [];
let ratingData = { overall: 0, cleanliness: 0, staff: 0, recommend: null };
let currentLoginType = 'guest'; // 'guest' or 'admin'

// ============ BACKEND API CONFIGURATION ============
// Auto-detect API URL (works on localhost and Replit)
const API_BASE_URL = '/api';
    ? 'http://localhost:3000/api' 
    : '/api';

// API Helper Functions
async function apiCall(endpoint, method = 'GET', data = null) {
    const options = {
        method: method,
        headers: {
            'Content-Type': 'application/json',
        }
    };

    if (data) {
        options.body = JSON.stringify(data);
    }

    try {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, options);
        const result = await response.json();
        return result;
    } catch (error) {
        console.error(`API Error (${endpoint}):`, error);
        showToast(t('connectionError') || 'Connection error! Using local data.', 'error');
        return { success: false, error: error.message };
    }
}

// Load all data from backend
async function loadAllDataFromBackend() {
    try {
        showSyncIndicator();
        const response = await apiCall('/sync');

        if (response.success && response.data) {
            // Update global arrays with backend data
            requests = response.data.requests || [];
            rooms = response.data.rooms || [];
            guests = response.data.guests || [];
            foodMenu = response.data.foodMenu || [];
            reviews = response.data.reviews || [];

            console.log('✅ Data loaded from backend:', {
                requests: requests.length,
                rooms: rooms.length,
                guests: guests.length,
                foodMenu: foodMenu.length,
                reviews: reviews.length
            });

            // Save to localStorage as backup
            saveToLocal();

            // Refresh UI
            refreshAllUI();

            return true;
        }
        return false;
    } catch (error) {
        console.error('Failed to load from backend:', error);
        // Fallback to localStorage
        loadFromLocal();
        return false;
    }
}

// Save single request to backend
async function saveRequestToBackend(request) {
    const existing = requests.find(r => r.id === request.id);
    if (existing) {
        // Update existing request
        return await apiCall(`/requests/${request.id}`, 'PUT', request);
    } else {
        // Create new request
        return await apiCall('/requests', 'POST', request);
    }
}

// Save all requests to backend
async function syncAllRequestsToBackend() {
    for (const request of requests) {
        await saveRequestToBackend(request);
    }
    console.log('✅ All requests synced to backend');
}

// Save room to backend
async function saveRoomToBackend(room) {
    const existing = rooms.find(r => r.id === room.id);
    if (existing) {
        return await apiCall(`/rooms/${room.id}`, 'PUT', room);
    } else {
        return await apiCall('/rooms', 'POST', room);
    }
}

// Save guest to backend
async function saveGuestToBackend(guest) {
    return await apiCall('/guests', 'POST', guest);
}

// Save food item to backend
async function saveFoodToBackend(food) {
    const existing = foodMenu.find(f => f.id === food.id);
    if (existing) {
        return await apiCall(`/food/${food.id}`, 'PUT', food);
    } else {
        return await apiCall('/food', 'POST', food);
    }
}

// Save review to backend
async function saveReviewToBackend(review) {
    return await apiCall('/reviews', 'POST', review);
}

// Enhanced saveToLocal - now also syncs to backend
const originalSaveToLocal = saveToLocal;
saveToLocal = function() {
    // Save to localStorage
    if (typeof originalSaveToLocal === 'function') {
        originalSaveToLocal();
    }

    // Also sync to backend (async, don't wait)
    if (!offlineMode) {
        syncAllRequestsToBackend().catch(console.error);
    }
};

// Enhanced loadFromLocal - now loads from backend first
const originalLoadFromLocal = loadFromLocal;
loadFromLocal = function() {
    if (!offlineMode) {
        // Try to load from backend first
        loadAllDataFromBackend().then(success => {
            if (!success && typeof originalLoadFromLocal === 'function') {
                originalLoadFromLocal();
                refreshAllUI();
            }
        }).catch(() => {
            if (typeof originalLoadFromLocal === 'function') {
                originalLoadFromLocal();
                refreshAllUI();
            }
        });
    } else if (typeof originalLoadFromLocal === 'function') {
        originalLoadFromLocal();
        refreshAllUI();
    }
};

// Refresh all UI components after data load
function refreshAllUI() {
    // Refresh admin dashboard if visible
    if (document.getElementById('adminDashboard') && !document.getElementById('adminDashboard').classList.contains('hidden')) {
        updateAdminDashboard();
        renderAdminRequests();
        renderRooms();
        renderGuests();
        renderFoodMenu();
        renderReviews();
        renderQRCodes();
    }

    // Refresh guest dashboard if visible
    if (document.getElementById('guestDashboard') && !document.getElementById('guestDashboard').classList.contains('hidden')) {
        updateGuestDashboard();
        renderGuestRequests();
        renderDynamicFoodMenu();
    }
}

// Check backend health on startup
async function checkBackendHealth() {
    try {
        const response = await fetch(`${API_BASE_URL.replace('/api', '')}/health`);
        const data = await response.json();
        console.log('✅ Backend health:', data);
        return data.database === 'Connected';
    } catch (error) {
        console.warn('⚠️ Backend not reachable, using localStorage only');
        return false;
    }
}

// Initialize with backend connection
async function initWithBackend() {
    const backendAvailable = await checkBackendHealth();

    if (backendAvailable) {
        showToast(t('backendConnected') || '✅ Connected to server!', 'success');
        await loadAllDataFromBackend();
    } else {
        showToast(t('offlineModeActive') || '⚠️ Offline mode - using local storage', 'info');
        loadFromLocal();
    }

    // Continue with normal initialization
    if (typeof initApp === 'function') {
        initApp();
    }
}

// Call this after DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    initWithBackend();
});

// Settings with defaults
let hotelSettings = {
  name: 'Crown Plaza Hotel',
  currencySymbol: '$',
  priceFormat: 'symbol-first',
  transportPrices: { airport: 30, local: 15 },
  wifiPassword: 'CrownPlaza@2024'
};

// Data arrays
let requests = [];
let rooms = [];
let guests = [];
let reviews = [];
let inventory = [];
let maintenanceTasks = [];
let blacklist = [];
let loyaltyPoints = [];
let staffAttendance = [];
let staffPerformance = [];
let activityLogs = [];
let foodMenu = [];

// Admin credentials (for demo - in production use backend)
const adminCredentials = {
  'admin@crownplaza.com': 'admin123',
  'manager@crownplaza.com': 'manager123',
  'staff@crownplaza.com': 'staff123'
};

// 🔹 FIXED: Service Categories with translation keys
const serviceCategories = {
  housekeeping: [
    { key: 'catRoomCleaning', default: 'Room Cleaning' },
    { key: 'catExtraTowels', default: 'Extra Towels' },
    { key: 'catDeepCleaning', default: 'Deep Cleaning' },
    { key: 'catBedSheets', default: 'Bed Sheets Change' }
  ],
  maintenance: [
    { key: 'catACNotWorking', default: 'AC Not Working' },
    { key: 'catTVIssue', default: 'TV Issue' },
    { key: 'catPlumbing', default: 'Plumbing' },
    { key: 'catElectrical', default: 'Electrical' },
    { key: 'catFurnitureRepair', default: 'Furniture Repair' }
  ],
  restaurant: [
    { key: 'catOrderFood', default: 'Order Food' },
    { key: 'catRoomService', default: 'Room Service' },
    { key: 'catSpecialRequest', default: 'Special Request' },
    { key: 'catBreakfast', default: 'Breakfast' }
  ],
  laundry: [
    { key: 'catLaundryPickup', default: 'Laundry Pickup' },
    { key: 'catIronOnly', default: 'Iron Only' },
    { key: 'catDryCleaning', default: 'Dry Cleaning' }
  ],
  it: [
    { key: 'catWiFiIssue', default: 'WiFi Issue' },
    { key: 'catTVHelp', default: 'TV Help' },
    { key: 'catChargingProblem', default: 'Charging Problem' }
  ]
};

const localAttractions = [
  {name:'City Mall', distance:'2 km', type:'🛍️'},
  {name:'Beach', distance:'5 km', type:'🏖️'},
  {name:'Temple', distance:'3 km', type:'🛕'},
  {name:'Restaurant District', distance:'1 km', type:'🍽️'},
  {name:'Park', distance:'4 km', type:'🌳'}
];

const hotelEvents = [
  {name:'Live Music Night', date:'Every Friday', time:'8PM'},
  {name:'Breakfast Buffet', date:'Daily', time:'7AM-10AM'},
  {name:'Pool Party', date:'Saturday', time:'2PM'},
  {name:'Spa Special', date:'Weekdays', time:'10AM-6PM'},
  {name:'Business Conference', date:'Monthly', time:'9AM-5PM'}
];

const defaultFoodMenu = [
  { id: 1, name: 'Burger', price: 12, category: 'Main Course', description: 'Juicy beef burger with fries' },
  { id: 2, name: 'Pizza', price: 15, category: 'Main Course', description: 'Margherita pizza' },
  { id: 3, name: 'Pasta', price: 14, category: 'Main Course', description: 'Creamy Alfredo pasta' },
  { id: 4, name: 'Coffee', price: 4, category: 'Beverage', description: 'Freshly brewed coffee' },
  { id: 5, name: 'Caesar Salad', price: 10, category: 'Appetizer', description: 'Fresh greens with parmesan' },
  { id: 6, name: 'Chocolate Cake', price: 8, category: 'Dessert', description: 'Rich chocolate layer cake' }
];

// 🔹 TRANSLATIONS DICTIONARY - COMPLETE WITH ALL CATEGORIES

// 🔹 TRANSLATION HELPER FUNCTION
function t(key, params = {}) {
  let text = translations[currentLanguage]?.[key] || translations['en'][key] || key;
  for (const [k, v] of Object.entries(params)) {
    text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
  }
  return text;
}

// 🔹 ENHANCED CHANGE LANGUAGE FUNCTION
function changeLanguage(lang) {
  currentLanguage = lang;

  // Update HTML lang and direction attributes
  document.documentElement.lang = lang;
  document.documentElement.dir = (lang === 'ar') ? 'rtl' : 'ltr';

  // Update body class for RTL styling
  if (lang === 'ar') {
    document.body.classList.add('rtl');
    document.body.style.textAlign = 'right';
  } else {
    document.body.classList.remove('rtl');
    document.body.style.textAlign = '';
  }

  // Update active button state
  document.querySelectorAll('.lang-btn').forEach(btn => btn.classList.remove('active'));
  if (event && event.target && event.target.classList.contains('lang-btn')) {
    event.target.classList.add('active');
  }

  // Update currency symbols
  updateCurrencyForLanguage(lang);

  // Re-render dynamic content with new language
  if (document.getElementById('adminDashboard') && !document.getElementById('adminDashboard').classList.contains('hidden')) {
    renderAdminRequests();
    renderRooms();
    renderFoodMenu();
    renderInventory();
    renderMaintenance();
    renderBlacklist();
    renderLoyalty();
    renderStaffPerformance();
    renderActivityLogs();
    renderQRCodes();
    updateAdminDashboard();
  }

  if (document.getElementById('guestDashboard') && !document.getElementById('guestDashboard').classList.contains('hidden')) {
    renderGuestRequests();
    renderDynamicFoodMenu();
    updateGuestDashboard();
    updateAllDisplays();
  }

  // Update live clock with new language format
  updateLiveClock();

  // Save preference
  localStorage.setItem('preferredLanguage', lang);

  // Speak confirmation
  speakText(t('languageChanged') + lang);
}

// 🔹 CURRENCY UPDATE FOR LANGUAGE
function updateCurrencyForLanguage(lang) {
  const currencyMap = { en: '$', hi: '₹', ar: 'ر.س' };
  const newSymbol = currencyMap[lang] || '$';

  // Update hotel settings
  hotelSettings.currencySymbol = newSymbol;

  // Update all currency displays
  document.querySelectorAll('.currency-badge').forEach(el => el.textContent = newSymbol);

  const elements = [
    'currencyDisplay', 'loyaltyCurrencyDisplay', 'foodCurrencyBadge',
    'transportCurrency1', 'transportCurrency2'
  ];
  elements.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = newSymbol;
  });

  // Re-render price-dependent content
  updateTransportPriceDisplays();
  renderFoodMenu();
  renderDynamicFoodMenu();
}

// ============ SESSION PERSISTENCE & AUTH ============
function checkSavedSession() {
  const TTL = 24 * 60 * 60 * 1000; // 24 hours
  const savedAdmin = localStorage.getItem('crown_plaza_admin_session');
  const savedGuest = localStorage.getItem('crown_plaza_customer_session');

  // Check Admin Session
  if (savedAdmin) {
    try {
      const session = JSON.parse(savedAdmin);
      if (session.role && session.timestamp && (Date.now() - session.timestamp < TTL)) {
        currentAdminRole = session.role;
        const roleNames = { 
          super_admin:'Super Admin', front_desk:'Front Desk', 
          housekeeping:'Housekeeping', maintenance:'Maintenance', 
          restaurant:'Restaurant', laundry:'Laundry', 
          security:'Security', it_support:'IT Support' 
        };

        // Update UI
        document.getElementById('roleDisplay').innerText = roleNames[session.role] || session.role;
        document.getElementById('adminRoleBadge').innerHTML = roleNames[session.role] || session.role;

        // Show admin dashboard
        document.getElementById('loginSelectionPage').classList.add('hidden');
        document.getElementById('roleSelectionPage').classList.add('hidden');
        document.getElementById('adminDashboard').classList.remove('hidden');

        document.documentElement.setAttribute('data-session','admin');

        // Initialize admin features
        setTimeout(() => {
          showAdminTab('overview');
          updateAdminDashboard();
          initCharts();
          renderHeatMap();
          renderInventory();
          renderMaintenance();
          renderBlacklist();
          renderLoyalty();
          renderStaffPerformance();
          updateSLAStats();
          renderQRCodes();
          renderRooms();
          renderFoodMenu();
          updateAllDisplays();
          showToast(t('welcomeBack'), 'success');
        }, 100);

        return true;
      } else {
        localStorage.removeItem('crown_plaza_admin_session');
        document.documentElement.removeAttribute('data-session');
      }
    } catch(e) { 
      console.error('Admin session error:', e);
      localStorage.removeItem('crown_plaza_admin_session');
      document.documentElement.removeAttribute('data-session');
    }
  }

  // Check Guest Session
  if (savedGuest) {
    try {
      const session = JSON.parse(savedGuest);
      if (session.name && session.room && session.timestamp && (Date.now() - session.timestamp < TTL)) {
        currentGuest = { name: session.name, room: session.room };

        // Show guest dashboard
        document.getElementById('loginSelectionPage').classList.add('hidden');
        document.getElementById('guestDashboard').classList.remove('hidden');
        document.getElementById('guestInfo').innerHTML = `👤 ${currentGuest.name} | Room ${currentGuest.room}`;

        document.documentElement.setAttribute('data-session','guest');

        // Initialize guest features
        setTimeout(() => {
          showGuestTab('newRequest');
          updateGuestDashboard();
          updateAllDisplays();
          renderDynamicFoodMenu();
          showToast(`${t('guestWelcome')} ${currentGuest.name}!`, 'success');
        }, 100);

        return true;
      } else {
        localStorage.removeItem('crown_plaza_customer_session');
        document.documentElement.removeAttribute('data-session');
      }
    } catch(e) { 
      console.error('Guest session error:', e);
      localStorage.removeItem('crown_plaza_customer_session');
      document.documentElement.removeAttribute('data-session');
    }
  }

  return false;
}

function switchLoginType(type) {
  currentLoginType = type;
  document.getElementById('guestTabBtn').className = type === 'guest' ? 'flex-1 py-2 rounded-lg font-semibold bg-purple-100 text-purple-700 transition' : 'flex-1 py-2 rounded-lg font-semibold bg-gray-100 text-gray-700 transition';
  document.getElementById('adminTabBtn').className = type === 'admin' ? 'flex-1 py-2 rounded-lg font-semibold bg-purple-100 text-purple-700 transition' : 'flex-1 py-2 rounded-lg font-semibold bg-gray-100 text-gray-700 transition';

  if(type === 'guest') {
    document.getElementById('guestLoginForm').classList.remove('hidden');
    document.getElementById('adminLoginForm').classList.add('hidden');
  } else {
    document.getElementById('guestLoginForm').classList.add('hidden');
    document.getElementById('adminLoginForm').classList.remove('hidden');
  }
}

// Guest Login Handler
document.getElementById('guestLoginForm')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = document.getElementById('guestNameInput').value.trim();
  const room = document.getElementById('guestRoomInput').value.trim();

  if(name && room) {
    currentGuest = { name, room };

    // Save session
    localStorage.setItem('crown_plaza_customer_session', JSON.stringify({
      name, room, timestamp: Date.now()
    }));

    // Show guest dashboard
    document.getElementById('loginSelectionPage').classList.add('hidden');
    document.getElementById('guestDashboard').classList.remove('hidden');
    document.getElementById('guestInfo').innerHTML = `👤 ${name} | Room ${room}`;

    document.documentElement.setAttribute('data-session','guest');

    // Initialize
    showGuestTab('newRequest');
    updateGuestDashboard();
    updateAllDisplays();
    renderDynamicFoodMenu();

    showToast(`${t('guestWelcome')} ${name}!`, 'success');
    addActivityLog(t('logGuestLogin'), `${name} - Room ${room}`);
  }
});

// Admin Login Handler
document.getElementById('adminLoginForm')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const email = document.getElementById('adminEmailInput').value.trim();
  const password = document.getElementById('adminPasswordInput').value;

  // Simple validation (in production, use backend)
  if(adminCredentials[email] && adminCredentials[email] === password) {
    // Show role selection
    document.getElementById('loginSelectionPage').classList.add('hidden');
    document.getElementById('roleSelectionPage').classList.remove('hidden');

    showToast(t('loginSuccess'), 'success');
    addActivityLog('ADMIN_LOGIN_ATTEMPT', email);
  } else {
    showToast(t('invalidCredentials'), 'error');
  }
});

function loginAsRole(role) {
  currentAdminRole = role;
  const roleNames = { 
    super_admin: 'Super Admin', front_desk: 'Front Desk', 
    housekeeping: 'Housekeeping', maintenance: 'Maintenance', 
    restaurant: 'Restaurant', laundry: 'Laundry', 
    security: 'Security', it_support: 'IT Support' 
  };

  document.getElementById('roleDisplay').innerText = roleNames[role];
  document.getElementById('adminRoleBadge').innerHTML = roleNames[role];

  document.getElementById('roleSelectionPage').classList.add('hidden');
  document.getElementById('adminDashboard').classList.remove('hidden');

  document.documentElement.setAttribute('data-session','admin');

  // Save admin session
  localStorage.setItem('crown_plaza_admin_session', JSON.stringify({
    role, timestamp: Date.now()
  }));

  // Remove guest session if exists
  localStorage.removeItem('crown_plaza_customer_session');

  // Initialize admin features
  showAdminTab('overview');
  updateAdminDashboard();
  initCharts();
  renderHeatMap();
  renderInventory();
  renderMaintenance();
  renderBlacklist();
  renderLoyalty();
  renderStaffPerformance();
  updateSLAStats();
  renderQRCodes();
  renderRooms();
  renderFoodMenu();

  showToast(`${t('adminWelcome')} ${roleNames[role]}!`, 'success');
  addActivityLog(t('logAdminLogin'), roleNames[role]);
  updateAllDisplays();
}

// ============ INITIALIZATION ============
function initSampleData() {
  if(rooms.length === 0) {
    for(let i=101; i<=150; i++) rooms.push({ 
      id:i, number:i, 
      type:i%3===0?'Suite':(i%2===0?'Deluxe':'Standard'), 
      status:i%4===0?'Vacant':(i%3===0?'Cleaning':'Occupied'), 
      guestName:i%4===0?'':`Guest ${i}` 
    });
  }
  if(guests.length === 0) {
    guests.push({ name:'John Smith', room:101, checkIn:'2024-01-15', checkOut:'2024-01-20', points:120, phone:'+1234567890', email:'john@example.com' });
    guests.push({ name:'Sarah Johnson', room:102, checkIn:'2024-01-16', checkOut:'2024-01-21', points:75, phone:'+1234567891', email:'sarah@example.com' });
    guests.push({ name:'Michael Brown', room:103, checkIn:'2024-01-17', checkOut:'2024-01-22', points:200, phone:'+1234567892', email:'michael@example.com' });
  }
  if(reviews.length === 0) {
    reviews.push({ guestName:'John Smith', room:101, overall:5, cleanliness:5, staff:5, recommend:true, comment:'Excellent stay! Very helpful staff.', date:'2024-01-20' });
  }
  if(inventory.length === 0) {
    inventory = [
      { item:'Towels', quantity:150, unit:'pcs', minStock:50 },
      { item:'Linen Sheets', quantity:80, unit:'sets', minStock:30 },
      { item:'Pillows', quantity:60, unit:'pcs', minStock:20 },
      { item:'Bathrobes', quantity:45, unit:'pcs', minStock:15 },
      { item:'Toiletries Kit', quantity:200, unit:'pcs', minStock:80 }
    ];
  }
  if(maintenanceTasks.length === 0) {
    maintenanceTasks = [
      { id:1, room:105, task:'AC Service', date:'2024-01-25', status:'Scheduled', priority:'high'},
      { id:2, room:108, task:'TV Repair', date:'2024-01-26', status:'Pending', priority:'medium'},
      { id:3, room:112, task:'Plumbing Leak', date:'2024-01-27', status:'Scheduled', priority:'high'}
    ];
  }
  if(blacklist.length === 0) {
    blacklist = [{ name:'Fraud User', room:999, reason:'Payment default', date:'2024-01-10', phone:'1234567890'}];
  }
  if(loyaltyPoints.length === 0) {
    loyaltyPoints = guests.map(g => ({ name:g.name, points:g.points || 0, phone:g.phone }));
  }
  if(staffPerformance.length === 0) {
    staffPerformance = [
      { name:'John (Housekeeping)', completed:45, pending:2, rating:4.8, department:'housekeeping'},
      { name:'Mike (Maintenance)', completed:32, pending:5, rating:4.5, department:'maintenance'},
      { name:'Sarah (Restaurant)', completed:28, pending:1, rating:4.9, department:'restaurant'},
      { name:'David (Front Desk)', completed:56, pending:3, rating:4.7, department:'front_desk'}
    ];
  }
  if(requests.length === 0) {
    requests.push({ id:1, guestName:'John Smith', roomNumber:'101', department:'maintenance', category:'AC Not Working', description:'AC not cooling properly', priority:'high', status:'in_progress', createdAt:new Date().toISOString() });
    requests.push({ id:2, guestName:'Sarah Johnson', roomNumber:'102', department:'housekeeping', category:'Extra Towels', description:'Need extra towels', priority:'medium', status:'open', createdAt:new Date(Date.now() - 3600000).toISOString() });
    requests.push({ id:3, guestName:'Michael Brown', roomNumber:'103', department:'restaurant', category:'Room Service', description:'Dinner for 2', priority:'normal', status:'completed', createdAt:new Date(Date.now() - 86400000).toISOString(), completedAt:new Date(Date.now() - 43200000).toISOString() });
  }
  if(foodMenu.length === 0) {
    foodMenu = JSON.parse(JSON.stringify(defaultFoodMenu));
  }

  let savedLogs = localStorage.getItem('crown_plaza_activity_logs');
  if(savedLogs) activityLogs = JSON.parse(savedLogs);
  else activityLogs = [{ id:1, action:t('logSystemStart'), details:'System initialized', timestamp:new Date().toLocaleString() }];
}

// ============ SETTINGS & DISPLAY UPDATES ============
function updateAllDisplays() {
  const hotelName = hotelSettings.name;
  document.getElementById('welcomeTitle').innerText = hotelName;
  document.getElementById('headerHotelName').innerText = hotelName.split(' ')[0];
  document.getElementById('guestHeaderHotelName').innerText = hotelName.split(' ')[0];
  document.getElementById('hotelNameDisplay').innerText = hotelName;
  document.getElementById('hotelNameInput').value = hotelName;
  document.getElementById('pageTitle').innerText = `${hotelName} - Ultimate Management System`;

  const currency = hotelSettings.currencySymbol;
  document.getElementById('currencySymbolInput').value = currency;
  document.getElementById('currencyDisplay').innerText = currency;
  document.getElementById('loyaltyCurrencyDisplay').innerText = currency;
  document.getElementById('foodCurrencyBadge').innerText = currency;
  document.getElementById('transportCurrency1').innerText = currency;
  document.getElementById('transportCurrency2').innerText = currency;

  document.getElementById('priceFormatInput').value = hotelSettings.priceFormat;

  document.getElementById('airportPriceInput').value = hotelSettings.transportPrices.airport;
  document.getElementById('localCabPriceInput').value = hotelSettings.transportPrices.local;
  updateTransportPriceDisplays();

  document.getElementById('wifiPasswordInput').value = hotelSettings.wifiPassword;
  document.getElementById('guestWifiPassword').innerText = hotelSettings.wifiPassword;
  document.getElementById('faqWifiPassword').innerText = hotelSettings.wifiPassword;
}

function formatPrice(amount) {
  const { currencySymbol, priceFormat } = hotelSettings;
  const formatted = parseFloat(amount).toFixed(2);
  switch(priceFormat) {
    case 'symbol-first': return `${currencySymbol}${formatted}`;
    case 'symbol-last': return `${formatted}${currencySymbol}`;
    case 'space': return `${formatted} ${currencySymbol}`;
    default: return `${currencySymbol}${formatted}`;
  }
}

function updateTransportPriceDisplays() {
  document.getElementById('airportPriceDisplay').innerText = formatPrice(hotelSettings.transportPrices.airport);
  document.getElementById('localPriceDisplay').innerText = formatPrice(hotelSettings.transportPrices.local);
}

// ============ HOTEL NAME FUNCTIONS ============
function saveHotelName() {
  const newName = document.getElementById('hotelNameInput').value.trim();
  if(newName && newName.length >= 3) {
    hotelSettings.name = newName;
    saveSettings();
    updateAllDisplays();
    showToast(t('hotelNameUpdated'), 'success');
    speakText(`Hotel name changed to ${newName}`);
    addActivityLog(t('logHotelNameChange'), `Changed to: ${newName}`);
  } else {
    showToast(t('invalidHotelName'), 'error');
  }
}

// ============ CURRENCY FUNCTIONS ============
function saveCurrencySettings() {
  const symbol = document.getElementById('currencySymbolInput').value.trim() || '$';
  const format = document.getElementById('priceFormatInput').value;
  hotelSettings.currencySymbol = symbol;
  hotelSettings.priceFormat = format;
  saveSettings();
  updateAllDisplays();
  renderFoodMenu();
  renderDynamicFoodMenu();
  updateTransportPriceDisplays();
  showToast(t('currencySaved'), 'success');
  addActivityLog(t('logCurrencyChange'), `Symbol: ${symbol}, Format: ${format}`);
}

// ============ TRANSPORT PRICE FUNCTIONS ============
function saveTransportPrices() {
  const airport = parseFloat(document.getElementById('airportPriceInput').value) || 30;
  const local = parseFloat(document.getElementById('localCabPriceInput').value) || 15;
  hotelSettings.transportPrices = { airport, local };
  saveSettings();
  updateAllDisplays();
  updateTransportPriceDisplays();
  showToast(t('transportUpdated'), 'success');
  addActivityLog(t('logTransportChange'), `Airport: ${formatPrice(airport)}, Local: ${formatPrice(local)}/hr`);
}

// ============ ROOM MANAGEMENT FUNCTIONS ============
function openAddRoomModal() {
  document.getElementById('roomModalTitle').innerText = 'Add New Room';
  document.getElementById('roomForm').reset();
  document.getElementById('roomEditIndex').value = '-1';
  document.getElementById('roomModal').classList.add('active');
}

function openEditRoomModal(index) {
  const room = rooms[index];
  document.getElementById('roomModalTitle').innerText = 'Edit Room #' + room.number;
  document.getElementById('roomNumberInput').value = room.number;
  document.getElementById('roomTypeInput').value = room.type;
  document.getElementById('roomStatusInput').value = room.status;
  document.getElementById('roomGuestInput').value = room.guestName || '';
  document.getElementById('roomEditIndex').value = index;
  document.getElementById('roomModal').classList.add('active');
}

function closeRoomModal() {
  document.getElementById('roomModal').classList.remove('active');
}

document.getElementById('roomForm')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const index = parseInt(document.getElementById('roomEditIndex').value);
  const newRoom = {
    id: index >= 0 ? rooms[index].id : Date.now(),
    number: parseInt(document.getElementById('roomNumberInput').value),
    type: document.getElementById('roomTypeInput').value,
    status: document.getElementById('roomStatusInput').value,
    guestName: document.getElementById('roomGuestInput').value.trim() || ''
  };
  if(index >= 0) {
    rooms[index] = newRoom;
    showToast(`${t('roomUpdated')}${newRoom.number} ${t('updated')}`, 'success');
    addActivityLog(t('logRoomEdit'), `Room #${newRoom.number} modified`);
  } else {
    if(rooms.some(r => r.number === newRoom.number)) {
      showToast(t('roomExists'), 'error');
      return;
    }
    rooms.push(newRoom);
    document.getElementById('statTotalRooms').innerText = rooms.length;
    showToast(`${t('roomAdded')}${newRoom.number} ${t('added')}`, 'success');
    addActivityLog(t('logRoomAdd'), `New room #${newRoom.number} created`);
  }
  saveToLocal();
  renderRooms();
  renderQRCodes();
  closeRoomModal();
  updateAdminDashboard();
});

function deleteRoom(index) {
  if(confirm(t('deleteRoom'))) {
    const room = rooms[index];
    rooms.splice(index, 1);
    saveToLocal();
    renderRooms();
    renderQRCodes();
    document.getElementById('statTotalRooms').innerText = rooms.length;
    showToast(`${t('roomDeleted')}${room.number} ${t('deleted')}`, 'info');
    addActivityLog(t('logRoomDelete'), `Room #${room.number} removed`);
    updateAdminDashboard();
  }
}

function renderRooms() {
  let tbody = document.getElementById('roomsList');
  if(!tbody) return;
  if(rooms.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-gray-500">${t('noRooms')}</td></tr>`;
    return;
  }
  tbody.innerHTML = rooms.map((r, i) => `
    <tr class="border-b hover:bg-gray-50 dark:hover:bg-gray-700">
      <td class="p-2 font-semibold">#${r.number}</td>
      <td class="p-2">${r.type}</td>
      <td class="p-2"><span class="badge ${r.status === 'Occupied' ? 'bg-green-100 text-green-700' : r.status === 'Vacant' ? 'bg-blue-100 text-blue-700' : 'bg-yellow-100 text-yellow-700'}">${r.status === 'Occupied' ? t('occupied') : r.status === 'Vacant' ? t('vacant') : t('cleaning')}</span></td>
      <td class="p-2">${r.guestName || '-'}</td>
      <td class="p-2"><button onclick="showQRForRoom(${r.number})" class="room-action-btn qr">📷 View</button></td>
      <td class="p-2">
        <button onclick="openEditRoomModal(${i})" class="room-action-btn edit">✏️</button>
        <button onclick="deleteRoom(${i})" class="room-action-btn delete">🗑️</button>
      </td>
    </tr>
  `).join('');
}

// ============ QR CODE FUNCTIONS WITH DOWNLOAD ============
function generateQRForRoom(roomNumber) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(JSON.stringify({ room: roomNumber, hotel: hotelSettings.name }))}`;
}

function showQRForRoom(roomNumber) {
  const container = document.getElementById('qrPreviewContainer');
  container.innerHTML = `<div id="qrCodePreview" class="qr-code-container"></div>`;
  document.getElementById('qrRoomLabel').innerText = `${t('roomLabel')}${roomNumber} - ${hotelSettings.name}`;
  setTimeout(() => {
    new QRCode(document.getElementById('qrCodePreview'), {
      text: JSON.stringify({ room: roomNumber, hotel: hotelSettings.name }),
      width: 150,
      height: 150
    });
  }, 100);
  window.currentQRRoom = roomNumber;
  document.getElementById('qrDownloadModal').classList.add('active');
}

function downloadQRCode() {
  const qrContainer = document.getElementById('qrCodePreview');
  const canvas = qrContainer.querySelector('canvas');
  if(canvas) {
    const link = document.createElement('a');
    link.download = `QR-Room${window.currentQRRoom}-${hotelSettings.name.replace(/\s+/g, '-')}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    showToast(t('qrDownloaded'), 'success');
    addActivityLog(t('logQRDownload'), `Downloaded QR for Room #${window.currentQRRoom}`);
  } else {
    showToast(t('qrWait'), 'info');
  }
}

function renderQRCodes() {
  let container = document.getElementById('qrCodesContainer');
  if(!container) return;
  if(rooms.length === 0) {
    container.innerHTML = '<div class="col-span-full text-center py-8 text-gray-500">No rooms to display QR codes</div>';
    return;
  }
  container.innerHTML = rooms.slice(0, 16).map(r => `
    <div class="border rounded-xl p-3 text-center bg-gray-50 dark:bg-gray-700">
      <div id="qr-${r.number}" class="mx-auto mb-2"></div>
      <div class="font-bold text-sm">Room ${r.number}</div>
      <div class="text-xs text-gray-500">${r.type}</div>
      <div class="flex justify-center gap-1 mt-2">
        <button onclick="showQRForRoom(${r.number})" class="room-action-btn qr text-xs">📷 View</button>
        <button onclick="showGuestLoginWithRoom(${r.number})" class="room-action-btn edit text-xs">🔗 Use</button>
      </div>
    </div>
  `).join('');
  setTimeout(() => {
    rooms.slice(0, 16).forEach(r => {
      const container = document.getElementById(`qr-${r.number}`);
      if(container) {
        container.innerHTML = '';
        new QRCode(container, {
          text: JSON.stringify({ room: r.number, hotel: hotelSettings.name }),
          width: 80,
          height: 80
        });
      }
    });
  }, 100);
}

// ============ FOOD MENU CRUD FUNCTIONS ============
function openAddFoodModal() {
  document.getElementById('foodModalTitle').innerText = 'Add New Dish';
  document.getElementById('foodForm').reset();
  document.getElementById('foodEditIndex').value = '-1';
  document.getElementById('foodModal').classList.add('active');
}

function openEditFoodModal(index) {
  const item = foodMenu[index];
  document.getElementById('foodModalTitle').innerText = 'Edit: ' + item.name;
  document.getElementById('foodNameInput').value = item.name;
  document.getElementById('foodPriceInput').value = item.price;
  document.getElementById('foodCategoryInput').value = item.category;
  document.getElementById('foodDescInput').value = item.description || '';
  document.getElementById('foodEditIndex').value = index;
  document.getElementById('foodModal').classList.add('active');
}

function closeFoodModal() {
  document.getElementById('foodModal').classList.remove('active');
}

document.getElementById('foodForm')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const index = parseInt(document.getElementById('foodEditIndex').value);
  const newItem = {
    id: index >= 0 ? foodMenu[index].id : Date.now(),
    name: document.getElementById('foodNameInput').value.trim(),
    price: parseFloat(document.getElementById('foodPriceInput').value) || 0,
    category: document.getElementById('foodCategoryInput').value,
    description: document.getElementById('foodDescInput').value.trim()
  };
  if(index >= 0) {
    foodMenu[index] = newItem;
    showToast(`${t('foodUpdated')}${newItem.name}" ${t('updated')}`, 'success');
    addActivityLog(t('logFoodEdit'), `Updated: ${newItem.name}`);
  } else {
    foodMenu.push(newItem);
    showToast(`${t('foodAdded')}${newItem.name}" ${t('addedToMenu')}`, 'success');
    addActivityLog(t('logFoodAdd'), `Added: ${newItem.name}`);
  }
  saveToLocal();
  renderFoodMenu();
  renderDynamicFoodMenu();
  closeFoodModal();
});

function deleteFoodItem(index) {
  if(confirm(t('deleteFood'))) {
    const item = foodMenu[index];
    foodMenu.splice(index, 1);
    saveToLocal();
    renderFoodMenu();
    renderDynamicFoodMenu();
    showToast(`${t('foodRemoved')}${item.name}" ${t('removedFromMenu')}`, 'info');
    addActivityLog(t('logFoodDelete'), `Removed: ${item.name}`);
  }
}

function renderFoodMenu() {
  let container = document.getElementById('foodMenuList');
  if(!container) return;
  if(foodMenu.length === 0) {
    container.innerHTML = `<div class="text-center py-8 text-gray-500">${t('noFood')}</div>`;
    return;
  }
  container.innerHTML = foodMenu.map((item, i) => `
    <div class="food-item-card flex justify-between items-start">
      <div class="flex-1">
        <div class="font-semibold">${escapeHtml(item.name)}</div>
        <div class="text-sm text-gray-600">${item.category}</div>
        <div class="text-xs text-gray-400 mt-1">${item.description || 'No description'}</div>
        <div class="font-bold text-purple-600 mt-1">${formatPrice(item.price)}</div>
      </div>
      <div class="flex flex-col gap-1">
        <button onclick="openEditFoodModal(${i})" class="room-action-btn edit">✏️ Edit</button>
        <button onclick="deleteFoodItem(${i})" class="room-action-btn delete">🗑️ Delete</button>
      </div>
    </div>
  `).join('');
}

function renderDynamicFoodMenu() {
  let container = document.getElementById('dynamicFoodMenu');
  if(!container) return;
  if(foodMenu.length === 0) {
    container.innerHTML = `<div class="col-span-2 text-center py-4 text-gray-500">${t('menuUpdating')}</div>`;
    return;
  }
  container.innerHTML = foodMenu.map(item => `
    <button onclick="addToCart('${escapeHtml(item.name)}', ${item.price})" class="p-3 border rounded-lg text-sm text-left hover:bg-purple-50 transition dark:hover:bg-purple-900/20">
      <div class="font-semibold">${escapeHtml(item.name)}</div>
      <div class="text-xs text-gray-500">${item.category}</div>
      <div class="font-bold text-purple-600 mt-1">${formatPrice(item.price)}</div>
    </button>
  `).join('');
}

// ============ SETTINGS SAVE/LOAD ============
function saveSettings() {
  localStorage.setItem('crown_plaza_settings', JSON.stringify(hotelSettings));
}

function loadSettings() {
  const saved = localStorage.getItem('crown_plaza_settings');
  if(saved) {
    try {
      const loaded = JSON.parse(saved);
      hotelSettings = { ...hotelSettings, ...loaded };
    } catch(e) {
      console.log('Using default settings');
    }
  }
}

// ============ DATA PERSISTENCE ============
function saveToLocal() {
  localStorage.setItem('crown_plaza_requests', JSON.stringify(requests));
  localStorage.setItem('crown_plaza_rooms', JSON.stringify(rooms));
  localStorage.setItem('crown_plaza_guests', JSON.stringify(guests));
  localStorage.setItem('crown_plaza_reviews', JSON.stringify(reviews));
  localStorage.setItem('crown_plaza_inventory', JSON.stringify(inventory));
  localStorage.setItem('crown_plaza_maintenance', JSON.stringify(maintenanceTasks));
  localStorage.setItem('crown_plaza_blacklist', JSON.stringify(blacklist));
  localStorage.setItem('crown_plaza_loyalty', JSON.stringify(loyaltyPoints));
  localStorage.setItem('crown_plaza_staff', JSON.stringify(staffPerformance));
  localStorage.setItem('crown_plaza_foodmenu', JSON.stringify(foodMenu));
  saveSettings();
}

function loadFromLocal() {
  let saved = localStorage.getItem('crown_plaza_requests'); if(saved) requests = JSON.parse(saved);
  let savedRooms = localStorage.getItem('crown_plaza_rooms'); if(savedRooms) rooms = JSON.parse(savedRooms);
  let savedGuests = localStorage.getItem('crown_plaza_guests'); if(savedGuests) guests = JSON.parse(savedGuests);
  let savedReviews = localStorage.getItem('crown_plaza_reviews'); if(savedReviews) reviews = JSON.parse(savedReviews);
  let savedInv = localStorage.getItem('crown_plaza_inventory'); if(savedInv) inventory = JSON.parse(savedInv);
  let savedMaint = localStorage.getItem('crown_plaza_maintenance'); if(savedMaint) maintenanceTasks = JSON.parse(savedMaint);
  let savedBlack = localStorage.getItem('crown_plaza_blacklist'); if(savedBlack) blacklist = JSON.parse(savedBlack);
  let savedLoyal = localStorage.getItem('crown_plaza_loyalty'); if(savedLoyal) loyaltyPoints = JSON.parse(savedLoyal);
  let savedStaff = localStorage.getItem('crown_plaza_staff'); if(savedStaff) staffPerformance = JSON.parse(savedStaff);
  let savedFood = localStorage.getItem('crown_plaza_foodmenu'); if(savedFood) foodMenu = JSON.parse(savedFood);
  loadSettings();
  initSampleData();
}

// ============ UTILITY FUNCTIONS ============
function updateLiveClock() {
  const now = new Date();
  const options = { timeZone: timezone, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true };
  const langCode = currentLanguage === 'hi' ? 'hi-IN' : currentLanguage === 'ar' ? 'ar-SA' : 'en-US';
  const formattedTime = now.toLocaleString(langCode, options);
  document.querySelectorAll('#liveDateTime, #liveClockAdmin, #liveClockGuest, #guestLocalTime, #localTimeDisplay').forEach(el => { if(el) el.innerText = formattedTime; });
  document.getElementById('timezoneDisplay').innerText = timezone;
}
setInterval(updateLiveClock, 1000);
updateLiveClock();

function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  const bgColor = type === 'success' ? 'border-green-500' : type === 'error' ? 'border-red-500' : 'border-blue-500';
  const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : '🔔';
  toast.className = `bg-white dark:bg-gray-800 rounded-lg shadow-lg p-3 mb-2 border-l-4 ${bgColor} fade-in`;
  toast.innerHTML = `<div class="flex items-center"><div class="flex-shrink-0 text-xl">${icon}</div><div class="ml-3"><p class="text-sm font-medium text-gray-900 dark:text-white">${message}</p></div><button onclick="this.parentElement.parentElement.remove()" class="ml-auto text-gray-400 hover:text-gray-600">✕</button></div>`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
  speakText(message);
  sendPushNotification('Crown Plaza', message);
}

function speakText(text) {
  if(!text) return;
  try {
    let utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.9;
    utterance.pitch = 1.2;
    // Try to set voice based on language
    const voices = window.speechSynthesis.getVoices();
    if (currentLanguage === 'hi') {
      const hiVoice = voices.find(v => v.lang.includes('hi'));
      if (hiVoice) utterance.voice = hiVoice;
    } else if (currentLanguage === 'ar') {
      const arVoice = voices.find(v => v.lang.includes('ar'));
      if (arVoice) utterance.voice = arVoice;
    }
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  } catch(e) { console.log('Speech not supported'); }
}

function sendPushNotification(title, body) {
  if('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body });
  }
}

function requestPushPermission() {
  if('Notification' in window) {
    Notification.requestPermission().then(perm => {
      if(perm === 'granted') { showToast(t('notificationsEnabled'),'success'); testNotification(); }
    });
  }
}

function testNotification() {
  if(Notification.permission === 'granted') new Notification('Crown Plaza Hotel', { body: 'Notifications are working! You will receive real-time updates.' });
}

function testHaptic() { if('vibrate' in navigator) { navigator.vibrate(200); showToast(t('vibrationTest'),'info'); } }

function toggleOfflineMode() {
  offlineMode = !offlineMode;
  if(offlineMode) document.body.classList.add('offline-mode');
  else document.body.classList.remove('offline-mode');
  localStorage.setItem('offlineMode', offlineMode);
  showToast(offlineMode ? t('offlineEnabled') : t('onlineRestored'), 'info');
}

function toggleThemeSelector() { document.getElementById('themeMenu').classList.toggle('hidden'); }

function setTheme(theme) {
  let gradients = { 
    default:'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', 
    sunset:'linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)', 
    forest:'linear-gradient(135deg, #10b981 0%, #059669 100%)', 
    ocean:'linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%)', 
    royal:'linear-gradient(135deg, #ec4899 0%, #8b5cf6 100%)' 
  };
  document.querySelectorAll('.gradient-bg').forEach(el => el.style.background = gradients[theme]);
  localStorage.setItem('theme', theme);
  document.getElementById('themeMenu').classList.add('hidden');
}

function toggleDarkMode() { 
  document.body.classList.toggle('dark'); 
  localStorage.setItem('darkMode', document.body.classList.contains('dark')); 
  document.getElementById('darkModeToggle').innerHTML = document.body.classList.contains('dark') ? '☀️' : '🌙'; 
}

function toggleHighContrast() { 
  document.body.classList.toggle('high-contrast'); 
  localStorage.setItem('highContrast', document.body.classList.contains('high-contrast')); 
  speakText('High contrast mode toggled'); 
}

function adjustFontSize(action) {
  let body = document.body;
  body.classList.remove('font-small', 'font-large');
  if(action === 'increase') body.classList.add('font-large');
  else if(action === 'decrease') body.classList.add('font-small');
  localStorage.setItem('fontSize', action);
}

function copyReferralCode() { navigator.clipboard.writeText('CROWN2024'); showToast(t('referralCopied'), 'success'); }

function toggleStaffAttendance() {
  isClockedIn = !isClockedIn;
  document.getElementById('staffStatusBadge').innerHTML = isClockedIn ? '🟢 Clocked In' : '⏳ Not Clocked In';
  showToast(isClockedIn ? t('clockedIn') : t('clockedOut'), 'success');
  addActivityLog(t('logStaffAttendance'), `${isClockedIn ? 'Clocked In' : 'Clocked Out'}`);
}

function saveWifiPassword() {
  const newPassword = document.getElementById('wifiPasswordInput').value.trim();
  if(newPassword) {
    hotelSettings.wifiPassword = newPassword;
    saveSettings();
    document.getElementById('guestWifiPassword').innerText = newPassword;
    document.getElementById('faqWifiPassword').innerText = newPassword;
    showToast(t('wifiUpdated'), 'success');
    speakText('WiFi password has been updated');
    addActivityLog(t('logWifiChange'), 'Admin updated WiFi password');
  }
}

function copyWifiPassword() { 
  navigator.clipboard.writeText(hotelSettings.wifiPassword); 
  showToast(t('wifiCopied'), 'success'); 
  speakText('WiFi password copied to clipboard'); 
}

function addActivityLog(action, details) {
  let log = { id: Date.now(), action, details, timestamp: new Date().toLocaleString() };
  activityLogs.unshift(log);
  if(activityLogs.length > 200) activityLogs.pop();
  localStorage.setItem('crown_plaza_activity_logs', JSON.stringify(activityLogs));
  renderActivityLogs();
}

function renderActivityLogs() {
  let container = document.getElementById('activityLogsList');
  if(container) container.innerHTML = activityLogs.slice(0,100).map(l => `<div class="border-b py-1 text-xs"><span class="text-gray-400">${l.timestamp}</span> - <strong>${l.action}</strong>: ${l.details}</div>`).join('');
}

// ============ INVENTORY FUNCTIONS ============
function addInventoryItem() {
  let item = prompt(t('itemName') + ':');
  let quantity = prompt(t('quantity') + ':');
  let unit = prompt(t('unit') + ' (pcs/sets/kg):', 'pcs');
  if(item && quantity) {
    inventory.push({ item, quantity: parseInt(quantity), unit: unit || 'pcs', minStock: 10 });
    localStorage.setItem('crown_plaza_inventory', JSON.stringify(inventory));
    renderInventory();
    showToast(`${item}${t('itemAdded')}`, 'success');
    addActivityLog(t('logInventoryAdd'), item);
  }
}

function updateInventoryQuantity(index, change) {
  inventory[index].quantity += change;
  if(inventory[index].quantity < 0) inventory[index].quantity = 0;
  localStorage.setItem('crown_plaza_inventory', JSON.stringify(inventory));
  renderInventory();
}

function renderInventory() {
  let container = document.getElementById('inventoryList');
  if(container) container.innerHTML = inventory.map((item, i) => `<div class="flex justify-between items-center p-3 border rounded-lg"><div><strong>${escapeHtml(item.item)}</strong><br><span class="text-xs">${item.quantity} ${item.unit}</span><br><span class="text-xs text-gray-400">Min: ${item.minStock}</span></div><div><button onclick="updateInventoryQuantity(${i}, -1)" class="bg-red-100 px-2 py-1 rounded text-red-600">-1</button><button onclick="updateInventoryQuantity(${i}, 1)" class="bg-green-100 px-2 py-1 rounded text-green-600 ml-2">+1</button><button onclick="deleteInventoryItem(${i})" class="bg-gray-100 px-2 py-1 rounded text-gray-600 ml-2">🗑️</button></div></div>`).join('');
}

function deleteInventoryItem(index) {
  if(confirm(t('deleteItem'))) {
    let item = inventory[index];
    inventory.splice(index, 1);
    localStorage.setItem('crown_plaza_inventory', JSON.stringify(inventory));
    renderInventory();
    showToast(`${item.item}${t('itemDeleted')}`, 'info');
    addActivityLog(t('logInventoryDelete'), item.item);
  }
}

// ============ MAINTENANCE FUNCTIONS ============
function addMaintenanceTask() {
  let room = prompt(t('roomNumber') + ':');
  let task = prompt(t('task') + ':');
  let date = prompt(t('date') + ' (YYYY-MM-DD):');
  let priority = prompt(t('priority') + ' (low/medium/high):', 'medium');
  if(room && task && date) {
    maintenanceTasks.push({ id: Date.now(), room, task, date, status: 'Scheduled', priority: priority || 'medium' });
    localStorage.setItem('crown_plaza_maintenance', JSON.stringify(maintenanceTasks));
    renderMaintenance();
    showToast(t('maintenanceScheduled'), 'success');
    addActivityLog(t('logMaintenanceAdd'), `Room ${room}: ${task}`);
  }
}

function renderMaintenance() {
  let container = document.getElementById('maintenanceList');
  if(container) container.innerHTML = maintenanceTasks.map(t => `<div class="flex justify-between items-center p-3 border rounded-lg"><div><strong>Room ${t.room}</strong> - ${t.task}<br><span class="text-xs">📅 ${t.date} | ${t.status} | ${t.priority}</span></div><div><button onclick="completeMaintenance(${t.id})" class="text-green-600">✅ Complete</button><button onclick="deleteMaintenance(${t.id})" class="text-red-600 ml-2">🗑️</button></div></div>`).join('');
}

function completeMaintenance(id) {
  maintenanceTasks = maintenanceTasks.filter(t => t.id !== id);
  localStorage.setItem('crown_plaza_maintenance', JSON.stringify(maintenanceTasks));
  renderMaintenance();
  showToast(t('maintenanceCompleted'), 'success');
  addActivityLog(t('logMaintenanceComplete'), `Task ${id}`);
}

function deleteMaintenance(id) {
  if(confirm(t('deleteTask'))) {
    maintenanceTasks = maintenanceTasks.filter(t => t.id !== id);
    localStorage.setItem('crown_plaza_maintenance', JSON.stringify(maintenanceTasks));
    renderMaintenance();
    showToast(t('taskDeleted'), 'info');
  }
}

// ============ BLACKLIST FUNCTIONS ============
function addToBlacklist() {
  let name = prompt(t('guestName') + ':');
  let reason = prompt(t('reason') + ':');
  let room = prompt(t('roomNumber') + ' (optional):', 'N/A');
  if(name && reason) {
    blacklist.push({ name, room: room || 'N/A', reason, date: new Date().toISOString().split('T')[0] });
    localStorage.setItem('crown_plaza_blacklist', JSON.stringify(blacklist));
    renderBlacklist();
    showToast(`${name}${t('blacklistAdded')}`, 'success');
    addActivityLog(t('logBlacklistAdd'), name);
  }
}

function renderBlacklist() {
  let container = document.getElementById('blacklistList');
  if(container) container.innerHTML = blacklist.map((b, i) => `<div class="border-l-4 border-red-500 bg-red-50 p-3 rounded-lg"><div class="flex justify-between"><div><strong>${escapeHtml(b.name)}</strong> - Room ${b.room}<br><span class="text-xs">${b.reason}</span><br><small>${b.date}</small></div><button onclick="removeFromBlacklist(${i})" class="text-red-600">Remove</button></div></div>`).join('');
}

function removeFromBlacklist(index) {
  let name = blacklist[index].name;
  blacklist.splice(index, 1);
  localStorage.setItem('crown_plaza_blacklist', JSON.stringify(blacklist));
  renderBlacklist();
  showToast(t('blacklistRemoved'), 'info');
  addActivityLog(t('logBlacklistRemove'), name);
}

// ============ LOYALTY FUNCTIONS ============
function addLoyaltyPoints(guestName, points) {
  let guest = loyaltyPoints.find(l => l.name === guestName);
  if(guest) guest.points += points;
  else loyaltyPoints.push({ name: guestName, points });
  localStorage.setItem('crown_plaza_loyalty', JSON.stringify(loyaltyPoints));
  renderLoyalty();
  if(currentGuest && currentGuest.name === guestName) updateGuestDashboard();
}

function renderLoyalty() {
  let container = document.getElementById('loyaltyList');
  if(container) container.innerHTML = loyaltyPoints.map((l, i) => `<div class="flex justify-between items-center p-3 border rounded-lg"><div><strong>${escapeHtml(l.name)}</strong><br><span class="text-yellow-600">⭐ ${l.points} points</span></div><div><button onclick="redeemPoints(${i})" class="bg-purple-100 px-2 py-1 rounded text-purple-600 text-sm">Redeem</button><button onclick="addPointsToGuest(${i})" class="bg-green-100 px-2 py-1 rounded text-green-600 text-sm ml-2">+Add</button></div></div>`).join('');
}

function redeemPoints(index) {
  let guest = loyaltyPoints[index];
  if(guest && guest.points >= 100) {
    guest.points -= 100;
    showToast(`${guest.name}${t('pointsRedeemed')}${formatPrice(10)} ${t('discount')}!`, 'success');
    speakText(`${guest.name} redeemed loyalty points`);
    renderLoyalty();
    addActivityLog(t('logLoyaltyRedeem'), `${guest.name} redeemed 100 points`);
  } else {
    showToast(t('needPoints'), 'error');
  }
}

function addPointsToGuest(index) {
  let points = prompt('Enter points to add:', '10');
  if(points && !isNaN(points)) {
    loyaltyPoints[index].points += parseInt(points);
    localStorage.setItem('crown_plaza_loyalty', JSON.stringify(loyaltyPoints));
    renderLoyalty();
    showToast(`${t('pointsAdded')}${points}`, 'success');
    addActivityLog(t('logLoyaltyAdd'), `${loyaltyPoints[index].name} +${points} points`);
  }
}

// ============ STAFF PERFORMANCE ============
function renderStaffPerformance() {
  let container = document.getElementById('staffPerformanceList');
  if(container) container.innerHTML = staffPerformance.map(s => `<div class="flex justify-between items-center p-3 border rounded-lg"><div><strong>${s.name}</strong><br><span class="text-xs">✅ Completed: ${s.completed} | ⏳ Pending: ${s.pending} | ⭐ Rating: ${s.rating}</span></div><div class="w-32 h-2 bg-gray-200 rounded-full"><div class="h-2 bg-green-500 rounded-full" style="width: ${(s.completed/(s.completed+s.pending))*100}%"></div></div><button onclick="addStaffRating('${s.name}')" class="text-purple-600 text-xs ml-2">⭐ Rate</button></div>`).join('');
}

function addStaffRating(name) {
  let rating = prompt('Enter rating (1-5):', '5');
  if(rating && rating >= 1 && rating <= 5) {
    let staff = staffPerformance.find(s => s.name === name);
    if(staff) staff.rating = parseFloat(rating);
    localStorage.setItem('crown_plaza_staff', JSON.stringify(staffPerformance));
    renderStaffPerformance();
    showToast(`${t('rated')}${name} ${rating}⭐`, 'success');
  }
}

function updateSLAStats() {
  let avgResponse = (staffPerformance.reduce((a,b)=>a+b.completed,0) / staffPerformance.length).toFixed(0);
  let slaCompliance = 85;
  document.getElementById('slaStats').innerHTML = `<p>📊 Avg Daily Completed: ${avgResponse}</p><p>✅ SLA Compliance: ${slaCompliance}%</p><p>⏱️ Avg Resolution Time: 2.5 hours</p><p>🏆 Top Performer: ${staffPerformance.reduce((a,b)=>a.rating>b.rating?a:b).name}</p>`;
}

// ============ CHARTS & VISUALIZATIONS ============
function initCharts() {
  let deptCtx = document.getElementById('deptChart')?.getContext('2d');
  let occCtx = document.getElementById('occupancyChart')?.getContext('2d');
  let rateCtx = document.getElementById('ratingChart')?.getContext('2d');
  let peakCtx = document.getElementById('peakHourChart')?.getContext('2d');
  if(deptCtx) window.deptChart = new Chart(deptCtx, { type:'bar', data:{ labels:['HK','Maint','Rest','Laundry','IT'], datasets:[{ data:[0,0,0,0,0], backgroundColor:'#667eea' }] } });
  if(occCtx) window.occupancyChart = new Chart(occCtx, { type:'doughnut', data:{ labels:[t('occupied'),t('vacant'),t('cleaning')], datasets:[{ data:[0,0,0], backgroundColor:['#10b981','#f59e0b','#3b82f6'] }] } });
  if(rateCtx) window.ratingChart = new Chart(rateCtx, { type:'doughnut', data:{ labels:[t('satisfaction'),'Remaining'], datasets:[{ data:[0,0], backgroundColor:['#f59e0b','#e5e7eb'] }] } });
  if(peakCtx) window.peakHourChart = new Chart(peakCtx, { type:'line', data:{ labels:['6AM','9AM','12PM','3PM','6PM','9PM','12AM'], datasets:[{ label:'Requests', data:[2,8,15,12,20,18,5], borderColor:'#f59e0b', fill:true }] } });
}

function renderHeatMap() {
  let container = document.getElementById('heatMap');
  if(container) container.innerHTML = ['Lobby','Restaurant','Pool','Gym','Spa','Conference','Bar','Parking'].map(area => `<div class="p-3 rounded-lg text-center text-white" style="background: ${Math.random() > 0.5 ? '#ef4444' : '#f59e0b'}"><div class="text-xl">${area === 'Lobby' ? '🔥' : area === 'Restaurant' ? '🍽️' : area === 'Pool' ? '🏊' : '📍'}</div><div class="text-xs">${area}</div><div class="text-xs">${Math.floor(Math.random() * 80 + 10)} visitors</div></div>`).join('');
}

// ============ GUEST FUNCTIONS ============
function showLocalGuide() {
  let content = localAttractions.map(a => `<div class="flex justify-between p-2 border-b"><span>${a.type} ${a.name}</span><span>${a.distance}</span></div>`).join('');
  document.getElementById('localGuideContent').innerHTML = content;
  document.getElementById('localGuideModal').classList.remove('hidden');
}

function showEventCalendar() {
  let content = hotelEvents.map(e => `<div class="flex justify-between p-2 border-b"><span>${e.name}</span><span>${e.date} ${e.time}</span></div>`).join('');
  document.getElementById('eventContent').innerHTML = content;
  document.getElementById('eventModal').classList.remove('hidden');
}

function showEmergencyContacts() { document.getElementById('emergencyContactsModal').classList.remove('hidden'); }
function showFirstAidGuide() { document.getElementById('firstAidModal').classList.remove('hidden'); }
function showEvacuationMap() { document.getElementById('evacuationModal').classList.remove('hidden'); }
function showDigitalConcierge() { document.getElementById('conciergeModal').classList.remove('hidden'); updateAllDisplays(); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

function setWakeUpCall() {
  let time = prompt('Wake-up time (HH:MM):', '07:00');
  if(time) {
    showToast(`${t('wakeUpSet')} ${time}`, 'success');
    addActivityLog(t('logWakeUp'), `Set for ${time} - Room ${currentGuest?.room}`);
    speakText(`Wake up call set for ${time}`);
  }
}

function toggleDND() {
  window.dndEnabled = !window.dndEnabled;
  document.getElementById('dndBtn').innerHTML = window.dndEnabled ? '🔕 DND: ON' : '🔕 DND: OFF';
  showToast(window.dndEnabled ? t('dndOn') : t('dndOff'), 'info');
}

function showQRScanner() { document.getElementById('qrScannerModal').classList.remove('hidden'); }
function closeQRScanner() { document.getElementById('qrScannerModal').classList.add('hidden'); }

function processManualQR() {
  let room = document.getElementById('manualQrInput').value;
  if(room) {
    closeQRScanner();
    showGuestLoginWithRoom(room);
  }
}

function showGuestLoginWithRoom(room) {
  document.getElementById('loginSelectionPage').classList.add('hidden');
  document.getElementById('guestDashboard').classList.remove('hidden');
  currentGuest = { name: `Guest ${room}`, room: room };
  document.getElementById('guestInfo').innerHTML = `👤 ${currentGuest.name} | Room ${currentGuest.room}`;
  showGuestTab('newRequest');
  updateGuestDashboard();
  renderDynamicFoodMenu();
  speakText(`Welcome to Room ${room}`);
  addActivityLog('GUEST_LOGIN_QR', `Room ${room}`);
  localStorage.setItem('crown_plaza_customer_session', JSON.stringify({ name: currentGuest.name, room: currentGuest.room, timestamp: Date.now() }));
  updateAllDisplays();
}

function showSOSAlert() {
  document.getElementById('sosModal').classList.remove('hidden');
  sendPushNotification('🚨 SOS EMERGENCY', `Emergency from ${currentGuest?.room || 'Hotel'}`);
  addActivityLog(t('logSOS'), `Room ${currentGuest?.room}`);
  speakText(t('emergencyAlert'));
}

function closeSOSModal() { document.getElementById('sosModal').classList.add('hidden'); }

function exportToExcel() {
  let wsData = [['ID','Guest','Room','Department','Category','Priority','Status','Created At','Completed At']];
  requests.forEach(r => wsData.push([r.id, r.guestName, r.roomNumber, r.department, r.category, r.priority, r.status, r.createdAt, r.completedAt || '']));
  let ws = XLSX.utils.aoa_to_sheet(wsData);
  let wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Requests');
  XLSX.writeFile(wb, `crown-plaza-requests-${new Date().toISOString().split('T')[0]}.xlsx`);
  showToast(t('excelExported'),'success');
  addActivityLog(t('logExportExcel'), `Exported ${requests.length} requests`);
}

function exportAllData() {
  let data = { requests, rooms, guests, reviews, inventory, maintenanceTasks, blacklist, loyaltyPoints, staffPerformance, activityLogs, foodMenu, hotelSettings };
  let blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  let a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `crown-plaza-full-backup-${new Date().toISOString()}.json`;
  a.click();
  showToast(t('dataExported'),'success');
  addActivityLog(t('logExportAll'), 'Full backup exported');
}

function printInvoice() {
  let printContent = `<html><head><title>Crown Plaza Report</title><style>body{font-family:Arial;padding:20px;}table{width:100%;border-collapse:collapse;}th,td{border:1px solid #ddd;padding:8px;}</style></head><body><h1>${hotelSettings.name} Report</h1><p>Date: ${new Date().toLocaleString()}</p><table><tr><th>ID</th><th>Guest</th><th>Room</th><th>Type</th><th>Status</th></tr>${requests.slice(0,50).map(r => `<tr><td>${r.id}</td><td>${r.guestName}</td><td>${r.roomNumber}</td><td>${r.category}</td><td>${r.status}</td></tr>`).join('')}</table></body></html>`;
  let win = window.open();
  win.document.write(printContent);
  win.print();
}

function generateReport(type) {
  let output = '';
  let filtered = requests;
  if(type === 'daily') filtered = requests.filter(r => new Date(r.createdAt).toDateString() === new Date().toDateString());
  else if(type === 'weekly') { let weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7); filtered = requests.filter(r => new Date(r.createdAt) >= weekAgo); }
  else if(type === 'monthly') { let monthAgo = new Date(); monthAgo.setMonth(monthAgo.getMonth() - 1); filtered = requests.filter(r => new Date(r.createdAt) >= monthAgo); }
  output = `<h3 class="font-bold">${type.toUpperCase()} Report</h3><p>Total Requests: ${filtered.length}</p><p>Completed: ${filtered.filter(r=>r.status==='completed').length}</p><p>Pending: ${filtered.filter(r=>r.status!=='completed').length}</p><p>Completion Rate: ${filtered.length ? ((filtered.filter(r=>r.status==='completed').length/filtered.length)*100).toFixed(1) : 0}%</p><p>High Priority: ${filtered.filter(r=>r.priority==='high' || r.priority==='emergency').length}</p>`;
  document.getElementById('reportOutput').innerHTML = output;
  addActivityLog(t('logGenerateReport'), `${type} report`);
}

function toggleSelectAll() {
  const filtered = getFilteredRequestsForAdmin();
  if (selectedRequests.size === filtered.length) selectedRequests.clear();
  else filtered.forEach(r => selectedRequests.add(r.id));
  updateBulkUI();
  renderAdminRequests();
}

function toggleSelectRequest(id) {
  if (selectedRequests.has(id)) selectedRequests.delete(id);
  else selectedRequests.add(id);
  updateBulkUI();
  renderAdminRequests();
}

function updateBulkUI() {
  const bar = document.getElementById('bulkActionsBar');
  const count = selectedRequests.size;
  if (bar) { if (count > 0) bar.classList.remove('hidden'); else bar.classList.add('hidden'); document.getElementById('selectedCount').innerText = count; }
  const selectAllCheckbox = document.getElementById('selectAllCheckbox');
  if (selectAllCheckbox) { const filtered = getFilteredRequestsForAdmin(); selectAllCheckbox.checked = selectedRequests.size === filtered.length && filtered.length > 0; selectAllCheckbox.indeterminate = selectedRequests.size > 0 && selectedRequests.size < filtered.length; }
}

function bulkComplete() {
  if (selectedRequests.size === 0) return;
  if (confirm(`${t('completeSelected')}${selectedRequests.size}${t('deleteSelected')}`)) {
    requests = requests.map(r => {
      if (selectedRequests.has(r.id) && r.status !== 'completed') {
        addLoyaltyPoints(r.guestName, 10);
        return { ...r, status: 'completed', completedAt: new Date().toISOString() };
      }
      return r;
    });
    let completedCount = selectedRequests.size;
    selectedRequests.clear();
    saveToLocal();
    updateAdminDashboard();
    if (currentGuest) updateGuestDashboard();
    showToast(`✅ ${completedCount}${t('requestsCompleted')}`, 'success');
    updateBulkUI();
    addActivityLog(t('logBulkComplete'), `${completedCount} requests completed`);
  }
}

function bulkDelete() {
  if (selectedRequests.size === 0) return;
  if (confirm(`${t('deleteSelected')}${selectedRequests.size}${t('deleteSelectedWarn')}`)) {
    let deletedCount = selectedRequests.size;
    requests = requests.filter(r => !selectedRequests.has(r.id));
    selectedRequests.clear();
    saveToLocal();
    updateAdminDashboard();
    if (currentGuest) updateGuestDashboard();
    showToast(`🗑️ ${deletedCount}${t('requestsDeleted')}`, 'info');
    updateBulkUI();
    addActivityLog(t('logBulkDelete'), `${deletedCount} requests deleted`);
  }
}

function clearSelection() {
  selectedRequests.clear();
  updateBulkUI();
  renderAdminRequests();
}

function getFilteredRequestsForAdmin() {
  let filtered = [...requests];
  if (currentAdminFilter !== 'all') filtered = filtered.filter(r => r.status === currentAdminFilter);
  if (adminSearchQuery) {
    const query = adminSearchQuery.toLowerCase();
    filtered = filtered.filter(r => r.guestName.toLowerCase().includes(query) || r.roomNumber.toLowerCase().includes(query) || (r.category && r.category.toLowerCase().includes(query)));
  }
  if (currentAdminRole !== 'super_admin' && currentAdminRole !== 'front_desk') filtered = filtered.filter(r => r.department === currentAdminRole);
  const priorityOrder = { emergency: 0, high: 1, medium: 2, low: 3 };
  filtered.sort((a, b) => {
    if (a.status === 'open' && b.status !== 'open') return -1;
    if (a.status !== 'open' && b.status === 'open') return 1;
    if (a.status === 'in_progress' && b.status !== 'in_progress') return -1;
    if (a.status !== 'in_progress' && b.status === 'in_progress') return 1;
    return (priorityOrder[a.priority] || 3) - (priorityOrder[b.priority] || 3);
  });
  return filtered;
}

function filterAdminRequests(filter) { currentAdminFilter = filter; currentPage = 0; renderAdminRequests(); }

function completeRequest(id) {
  let req = requests.find(r => r.id === id);
  if(req && req.status !== 'completed') {
    req.status = 'completed';
    req.completedAt = new Date().toISOString();
    addLoyaltyPoints(req.guestName, 10);
    saveToLocal();
    updateAdminDashboard();
    showToast(`${t('completedFor')}${req.guestName}`, 'success');
    addActivityLog(t('logRequestComplete'), `${req.guestName} - ${req.category}`);
    let staff = staffPerformance.find(s => s.department === req.department);
    if(staff) { staff.completed++; staff.pending--; }
    renderStaffPerformance();
    if(currentGuest && currentGuest.name === req.guestName) renderGuestRequests();
    updateBulkUI();
  }
}

function deleteRequest(id) {
  if(confirm(t('deleteRequest'))) {
    let req = requests.find(r => r.id === id);
    requests = requests.filter(r => r.id !== id);
    selectedRequests.delete(id);
    saveToLocal();
    updateAdminDashboard();
    showToast(t('deleted'), 'info');
    addActivityLog(t('logRequestDelete'), `${req?.guestName} - ${req?.category}`);
    updateBulkUI();
  }
}

function renderAdminRequests() {
  let filtered = getFilteredRequestsForAdmin();
  let container = document.getElementById('adminRequestsList');
  if(!container) return;
  if(filtered.length === 0) { container.innerHTML = `<div class="text-center py-8 text-gray-500">${t('noRequests')}</div>`; return; }
  container.innerHTML = filtered.map(req => `
    <div class="border-l-4 ${req.priority === 'emergency' ? 'priority-emergency' : req.priority === 'high' ? 'priority-high' : req.priority === 'medium' ? 'priority-medium' : 'priority-low'} bg-gray-50 dark:bg-gray-700 p-3 rounded-lg text-sm draggable" data-id="${req.id}">
      <div class="flex flex-wrap justify-between gap-2">
        <div class="flex-1">
          <div class="flex items-center gap-2 mb-1">
            <input type="checkbox" class="select-all-checkbox" ${selectedRequests.has(req.id) ? 'checked' : ''} onclick="toggleSelectRequest(${req.id})">
            <strong>${escapeHtml(req.guestName)}</strong> - Room ${req.roomNumber}
            <span class="badge text-xs">${req.status === 'completed' ? '✅ '+t('completed') : req.status === 'in_progress' ? '🔄 '+t('inProgress') : '⏳ '+t('open')}</span>
            ${req.priority === 'emergency' ? '<span class="badge bg-red-600 text-white">🚨 '+t('emergency')+'</span>' : ''}
          </div>
          <div class="ml-7">
            <span class="text-xs font-semibold text-gray-700 dark:text-gray-300">${escapeHtml(req.category || req.department)}</span>
            <p class="text-xs mt-1">${escapeHtml(req.description) || t('noDescription')}</p>
            <span class="text-xs text-gray-400">📅 ${new Date(req.createdAt).toLocaleString()}</span>
            ${req.completedAt ? `<span class="text-xs text-green-600 ml-2">✅ ${t('resolved')}: ${new Date(req.completedAt).toLocaleString()}</span>` : ''}
          </div>
        </div>
        <div class="flex gap-1">
          ${req.status !== 'completed' ? `<button onclick="completeRequest(${req.id})" class="text-green-600 px-2 py-1" title="${t('complete')}">✅</button>` : '<span class="verified-tick">✓</span>'}
          <button onclick="deleteRequest(${req.id})" class="text-red-600 px-2 py-1" title="${t('delete')}">🗑️</button>
        </div>
      </div>
    </div>
  `).join('');
}

function updateAdminDashboard() {
  let openReqs = requests.filter(r => r.status === 'open').length;
  let inProgress = requests.filter(r => r.status === 'in_progress').length;
  let emergencyReqs = requests.filter(r => r.priority === 'emergency' && r.status !== 'completed').length;
  let occupied = rooms.filter(r => r.status === 'Occupied').length;
  document.getElementById('statOpenRequests').innerText = openReqs;
  document.getElementById('statInProgress').innerText = inProgress;
  document.getElementById('statEmergency').innerText = emergencyReqs;
  document.getElementById('statOccupied').innerText = occupied;
  document.getElementById('statTotalRooms').innerText = rooms.length;

  let deptStats = { housekeeping: 0, maintenance: 0, restaurant: 0, laundry: 0, it: 0 };
  requests.forEach(r => { if(deptStats[r.department] !== undefined) deptStats[r.department]++; });

  if(window.deptChart) { window.deptChart.data.datasets[0].data = [deptStats.housekeeping, deptStats.maintenance, deptStats.restaurant, deptStats.laundry, deptStats.it]; window.deptChart.update(); }
  if(window.occupancyChart) { window.occupancyChart.data.datasets[0].data = [occupied, rooms.filter(r => r.status === 'Vacant').length, rooms.filter(r => r.status === 'Cleaning').length]; window.occupancyChart.update(); }

  let avgRating = reviews.length ? (reviews.reduce((s, r) => s + r.overall, 0) / reviews.length).toFixed(1) : 0;
  if(window.ratingChart) { window.ratingChart.data.datasets[0].data = [avgRating, 5 - avgRating]; window.ratingChart.update(); }
  if(window.peakHourChart) window.peakHourChart.update();

  renderAdminRequests();

  let emergencyContainer = document.getElementById('emergencyRequestsList');
  if(emergencyContainer) {
    let emergencyReqsList = requests.filter(r => r.priority === 'emergency' && r.status !== 'completed');
    emergencyContainer.innerHTML = emergencyReqsList.length ? emergencyReqsList.map(r => `<div class="bg-red-50 p-2 rounded border-l-4 border-red-600"><strong>${r.guestName}</strong> - Room ${r.roomNumber}<br><span class="text-xs">${r.description}</span></div>`).join('') : `<div class="text-gray-500 text-sm">${t('noEmergency')}</div>`;
  }
}

function renderGuests() {
  let container = document.getElementById('guestsList');
  if(container) container.innerHTML = guests.map(g => `<div class="border rounded-lg p-3 text-sm"><div class="flex justify-between"><div><strong>${escapeHtml(g.name)}</strong> - Room ${g.room}<br><span class="text-xs">📞 ${g.phone || 'N/A'} | ✉️ ${g.email || 'N/A'}</span></div><div><span class="text-yellow-600">⭐ ${g.points || 0} pts</span></div></div><div class="mt-2"><button onclick="addLoyaltyPoints('${g.name}', 10)" class="text-green-600 text-xs">+10 pts</button></div></div>`).join('');
}

function renderReviews() {
  let container = document.getElementById('reviewsList');
  if(container) container.innerHTML = reviews.map(r => `<div class="border rounded-lg p-3"><div class="flex justify-between"><strong>${escapeHtml(r.guestName)}</strong><span>${'⭐'.repeat(r.overall)}</span></div><p class="text-sm">${escapeHtml(r.comment)}</p><div class="flex gap-2 text-xs text-gray-500 mt-1"><span>🧼 Clean: ${r.cleanliness || 4}⭐</span><span>👔 Staff: ${r.staff || 4}⭐</span><span>📅 ${r.date}</span></div></div>`).join('');
}

function updateGuestDashboard() {
  if(!currentGuest) return;
  let myRequests = requests.filter(r => r.guestName === currentGuest.name && r.roomNumber === currentGuest.room);
  document.getElementById('guestTotalRequests').innerText = myRequests.length;
  document.getElementById('guestPendingCount').innerText = myRequests.filter(r => r.status !== 'completed').length;
  document.getElementById('guestCompletedCount').innerText = myRequests.filter(r => r.status === 'completed').length;
  let points = loyaltyPoints.find(l => l.name === currentGuest.name)?.points || 0;
  document.getElementById('guestPoints').innerHTML = `⭐ ${points} pts`;
  let hasRating = reviews.some(r => r.guestName === currentGuest.name);
  document.getElementById('guestRatingStatus').innerHTML = hasRating ? '⭐ '+t('rated') : t('notRated');
}

function renderGuestRequests() {
  let myRequests = requests.filter(r => r.guestName === currentGuest?.name && r.roomNumber === currentGuest?.room);
  let container = document.getElementById('guestRequestsList');
  if(container) container.innerHTML = myRequests.length ? myRequests.map(req => `<div class="border-l-4 ${req.status === 'completed' ? 'border-green-500' : 'border-yellow-500'} bg-gray-50 p-3 rounded-lg text-sm"><div class="flex justify-between"><div><strong>${escapeHtml(req.category || req.department)}</strong><p class="text-xs">${escapeHtml(req.description)}</p><small>${new Date(req.createdAt).toLocaleString()}</small></div><div><span class="badge ${req.status === 'completed' ? 'bg-green-100' : 'bg-yellow-100'}">${req.status === 'completed' ? t('resolved')+' ✓' : t('pending')}</span>${req.status === 'completed' ? '<span class="verified-tick ml-1">✓</span>' : ''}</div></div></div>`).join('') : `<div class="text-center py-4 text-gray-500">${t('noGuestRequests')}</div>`;
}

function showGuestTab(tab) {
  ['guestNewRequestTab', 'guestFoodOrderTab', 'guestTransportTab', 'guestMyRequestsTab', 'guestHotelInfoTab'].forEach(t => { let el = document.getElementById(t); if(el) el.classList.add('hidden'); });
  document.getElementById(`guest${tab.charAt(0).toUpperCase() + tab.slice(1)}Tab`).classList.remove('hidden');
  if(tab === 'myRequests') renderGuestRequests();
  if(tab === 'hotelInfo') updateAllDisplays();
  if(tab === 'foodOrder') renderDynamicFoodMenu();
}

function addToCart(item, price) {
  cart.push({ item, price });
  updateCart();
  showToast(`${item}${t('itemAddedCart')}`, 'success');
  if('vibrate' in navigator) navigator.vibrate(50);
}

function updateCart() {
  let cartDiv = document.getElementById('cartItems');
  if(!cartDiv) return;
  if(cart.length === 0) {
    cartDiv.innerHTML = `<div class="text-center text-gray-500">${t('cartIsEmpty')}</div>`;
    document.getElementById('cartTotal').innerText = formatPrice(0);
    return;
  }
  const total = cart.reduce((s, c) => s + c.price, 0);
  cartDiv.innerHTML = cart.map((c, i) => `<div class="flex justify-between py-1"><span>${c.item}</span><span>${formatPrice(c.price)}</span><button onclick="removeFromCart(${i})" class="text-red-500">✕</button></div>`).join('') + `<div class="border-t pt-2 font-bold">Total: ${formatPrice(total)}</div>`;
  document.getElementById('cartTotal').innerText = formatPrice(total);
}

function removeFromCart(i) { cart.splice(i, 1); updateCart(); }

function placeOrder() {
  if(cart.length === 0) { alert(t('cartEmpty')); return; }
  let order = { id: Date.now(), guestName: currentGuest.name, roomNumber: currentGuest.room, department: 'restaurant', category: 'Food Order', description: `Order: ${cart.map(c => c.item).join(', ')}`, priority: 'normal', status: 'open', createdAt: new Date().toISOString() };
  requests.unshift(order);
  cart = [];
  updateCart();
  saveToLocal();
  updateAdminDashboard();
  showToast(t('orderPlaced'), 'success');
  speakText('Food order placed');
  addLoyaltyPoints(currentGuest.name, 5);
  showGuestTab('myRequests');
  renderGuestRequests();
}

function showCheckoutRating() {
  document.getElementById('ratingModal').classList.remove('hidden');
  ratingData = { overall: 0, cleanliness: 0, staff: 0, recommend: null };
  let createStars = (id, setFn) => {
    let container = document.getElementById(id);
    container.innerHTML = '';
    for(let i = 1; i <= 5; i++) {
      let star = document.createElement('span');
      star.innerHTML = '☆';
      star.className = 'star-rating';
      star.onclick = () => {
        ratingData[setFn] = i;
        updateStarDisplay(id, i);
      };
      container.appendChild(star);
    }
  };
  createStars('ratingStars', 'overall');
  createStars('cleanlinessStars', 'cleanliness');
  createStars('staffStars', 'staff');
  document.getElementById('recommendYes').className = 'px-4 py-1 bg-green-500 rounded';
  document.getElementById('recommendNo').className = 'px-4 py-1 bg-red-500 rounded';
}

function updateStarDisplay(containerId, rating) {
  let container = document.getElementById(containerId);
  if(container) {
    let stars = container.children;
    for(let i = 0; i < stars.length; i++) stars[i].innerHTML = i < rating ? '★' : '☆';
  }
}

function setRecommend(val) { 
  ratingData.recommend = val; 
  document.getElementById('recommendYes').className = val ? 'px-4 py-1 bg-green-700 text-white rounded' : 'px-4 py-1 bg-green-500 rounded'; 
  document.getElementById('recommendNo').className = !val ? 'px-4 py-1 bg-red-700 text-white rounded' : 'px-4 py-1 bg-red-500 rounded'; 
}

function submitRating() {
  if(ratingData.overall === 0) { alert(t('provideRating')); return; }
  reviews.push({ guestName: currentGuest.name, room: currentGuest.room, overall: ratingData.overall, cleanliness: ratingData.cleanliness || 4, staff: ratingData.staff || 4, recommend: ratingData.recommend, comment: document.getElementById('reviewText').value, date: new Date().toISOString().split('T')[0] });
  saveToLocal();
  document.getElementById('ratingModal').classList.add('hidden');
  showToast(t('thankYouReview'), 'success');
  addLoyaltyPoints(currentGuest.name, 20);
  addActivityLog(t('logReview'), `${currentGuest.name} rated ${ratingData.overall}⭐`);
  alert(t('thankYouStay') + hotelSettings.name + t('seeYouAgain'));
  logoutGuest();
}

function backToMain() {
  document.getElementById('loginSelectionPage').classList.remove('hidden');
  document.getElementById('roleSelectionPage').classList.add('hidden');
}

function showRoleSelection() {
  document.getElementById('loginSelectionPage').classList.add('hidden');
  document.getElementById('roleSelectionPage').classList.remove('hidden');
}

function showGuestLogin() {
  document.getElementById('loginSelectionPage').classList.add('hidden');
  document.getElementById('guestDashboard').classList.remove('hidden');
  currentGuest = { name: 'Guest', room: '101' };
  document.getElementById('guestInfo').innerHTML = `👤 ${currentGuest.name} | Room ${currentGuest.room}`;
  showGuestTab('newRequest');
  updateGuestDashboard();
  renderDynamicFoodMenu();
  speakText('Welcome to ' + hotelSettings.name);
  addActivityLog(t('logGuestLogin'), currentGuest.name);
  updateAllDisplays();
  localStorage.setItem('crown_plaza_customer_session', JSON.stringify({ name: currentGuest.name, room: currentGuest.room, timestamp: Date.now() }));
}

function logoutAdmin() {
  document.getElementById('adminDashboard').classList.add('hidden');
  document.getElementById('loginSelectionPage').classList.remove('hidden');
  speakText('Logged out from admin panel');
  addActivityLog(t('logAdminLogout'), 'Logged out');
  selectedRequests.clear();
  localStorage.removeItem('crown_plaza_admin_session');
  document.documentElement.removeAttribute('data-session');
}

function logoutGuest() {
  document.getElementById('guestDashboard').classList.add('hidden');
  document.getElementById('loginSelectionPage').classList.remove('hidden');
  currentGuest = null;
  speakText('Logged out');
  addActivityLog(t('logGuestLogout'), 'Logged out');
  localStorage.removeItem('crown_plaza_customer_session');
  document.documentElement.removeAttribute('data-session');
}

function showAdminTab(tab) {
  ['overviewTab', 'requestsTab', 'roomsTab', 'guestsTab', 'reviewsTab', 'reportsTab', 'qrcodesTab', 'logsTab', 'inventoryTab', 'maintenanceTab', 'blacklistTab', 'loyaltyTab', 'staffTab', 'foodmenuTab', 'settingsTab'].forEach(t => { let el = document.getElementById(t); if(el) el.classList.add('hidden'); });
  document.getElementById(`${tab}Tab`).classList.remove('hidden');
  if(tab === 'rooms') renderRooms();
  if(tab === 'guests') renderGuests();
  if(tab === 'reviews') renderReviews();
  if(tab === 'qrcodes') renderQRCodes();
  if(tab === 'logs') renderActivityLogs();
  if(tab === 'inventory') renderInventory();
  if(tab === 'maintenance') renderMaintenance();
  if(tab === 'blacklist') renderBlacklist();
  if(tab === 'loyalty') renderLoyalty();
  if(tab === 'staff') { renderStaffPerformance(); updateSLAStats(); }
  if(tab === 'foodmenu') renderFoodMenu();
  if(tab === 'settings') updateAllDisplays();
  document.querySelectorAll('.nav-tab').forEach(btn => btn.classList.remove('text-purple-600', 'border-b-2', 'border-purple-600'));
  let activeBtn = document.querySelector(`button[onclick="showAdminTab('${tab}')"]`);
  if(activeBtn) { activeBtn.classList.add('text-purple-600', 'border-b-2', 'border-purple-600'); }
}

// 🔹 FIXED: Category/Department Functions with Translations
function updateAdminCategories() {
  let dept = document.getElementById('reqDepartment').value;
  let catSelect = document.getElementById('reqCategory');
  catSelect.innerHTML = '<option value="">'+t('selectCategory')+'</option>';

  if(serviceCategories[dept]) {
    serviceCategories[dept].forEach(cat => {
      const label = t(cat.key) || cat.default;
      catSelect.innerHTML += `<option value="${cat.default}">${label}</option>`;
    });
  }
}

function updateGuestCategories() {
  let dept = document.getElementById('guestDepartment').value;
  let catSelect = document.getElementById('guestCategory');
  catSelect.innerHTML = '<option value="">'+t('selectService')+'</option>';

  if(serviceCategories[dept]) {
    serviceCategories[dept].forEach(cat => {
      const label = t(cat.key) || cat.default;
      catSelect.innerHTML += `<option value="${cat.default}">${label}</option>`;
    });
  }
}

function escapeHtml(str) {
  if(!str) return '';
  return str.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

// Event Listeners
document.getElementById('adminRequestForm')?.addEventListener('submit', (e) => {
  e.preventDefault();
  let newReq = { id: Date.now(), guestName: document.getElementById('reqGuestName').value, roomNumber: document.getElementById('reqRoomNumber').value, department: document.getElementById('reqDepartment').value, category: document.getElementById('reqCategory').value, description: document.getElementById('reqDescription').value, priority: document.getElementById('reqPriority').value, status: 'open', createdAt: new Date().toISOString() };
  if(!newReq.guestName || !newReq.roomNumber || !newReq.department) { alert(t('fillRequired')); return; }
  requests.unshift(newReq);
  saveToLocal();
  updateAdminDashboard();
  e.target.reset();
  showToast(t('requestCreated'), 'success');
  addActivityLog(t('logRequestCreate'), `${newReq.guestName} - ${newReq.category}`);
});

document.getElementById('guestRequestForm')?.addEventListener('submit', (e) => {
  e.preventDefault();
  if(!currentGuest) return;
  let newReq = { id: Date.now(), guestName: currentGuest.name, roomNumber: currentGuest.room, department: document.getElementById('guestDepartment').value, category: document.getElementById('guestCategory').value, description: document.getElementById('guestDescription').value, priority: document.getElementById('guestPriority').value === 'urgent' ? 'high' : 'normal', status: 'open', createdAt: new Date().toISOString() };
  requests.unshift(newReq);
  saveToLocal();
  updateAdminDashboard();
  updateGuestDashboard();
  renderGuestRequests();
  e.target.reset();
  showToast(t('requestSubmitted'), 'success');
  addActivityLog(t('logGuestRequest'), `${currentGuest.name} - ${newReq.category}`);
});

document.getElementById('transportForm')?.addEventListener('submit', (e) => {
  e.preventDefault();
  let transportReq = { id: Date.now(), guestName: currentGuest.name, roomNumber: currentGuest.room, department: 'transport', category: 'Transport', description: `${document.getElementById('transportType').value} at ${document.getElementById('transportTime').value}`, priority: 'normal', status: 'open', createdAt: new Date().toISOString() };
  requests.unshift(transportReq);
  saveToLocal();
  updateAdminDashboard();
  showToast(t('transportBooked'), 'success');
  addActivityLog(t('logTransport'), `${currentGuest.name} booked transport`);
  e.target.reset();
  showGuestTab('myRequests');
  renderGuestRequests();
});

// 🔹 FIXED: Event Listeners for Category Dropdowns
document.getElementById('reqDepartment')?.addEventListener('change', updateAdminCategories);
document.getElementById('guestDepartment')?.addEventListener('change', updateGuestCategories);
document.getElementById('adminSearchInput')?.addEventListener('input', (e) => { adminSearchQuery = e.target.value; renderAdminRequests(); });

// Modal close on outside click
document.querySelectorAll('.modal').forEach(modal => {
  modal.addEventListener('click', (e) => {
    if(e.target === modal) {
      modal.classList.remove('active');
    }
  });
});

// Initialize App
function initApp() {
  loadFromLocal();
  saveToLocal();

  // Check session FIRST before any other init
  const sessionRestored = checkSavedSession();

  // Only run full init if no session was restored
  if(!sessionRestored) {
    updateAllDisplays();
    renderRooms();
    renderFoodMenu();
    renderDynamicFoodMenu();
  }

  // Apply saved UI preferences
  if(localStorage.getItem('darkMode') === 'true') document.body.classList.add('dark');
  if(localStorage.getItem('highContrast') === 'true') document.body.classList.add('high-contrast');
  if(localStorage.getItem('theme')) setTheme(localStorage.getItem('theme'));
  if(localStorage.getItem('offlineMode') === 'true') toggleOfflineMode();

  // Set initial active language button
  document.querySelectorAll('.lang-btn').forEach(btn => btn.classList.remove('active'));
  const savedLang = localStorage.getItem('preferredLanguage') || 'en';
  const langBtn = Array.from(document.querySelectorAll('.lang-btn')).find(b => b.getAttribute('onclick')?.includes(`'${savedLang}'`));
  if (langBtn) langBtn.classList.add('active');

  // Initialize with saved language
  if (savedLang !== 'en') {
    changeLanguage(savedLang);
  }
}

// Start the app
initApp();
// ========== ADD HINDI & ARABIC TRANSLATIONS ==========
// Extending existing translations
if (typeof translations !== 'undefined') {
    translations.hi = translations.hi || {};
    translations.ar = translations.ar || {};

    // Hindi translations
    Object.assign(translations.hi, {
        welcomeTitle: "क्राउन प्लाज़ा होटल",
        guestTab: "🏨 अतिथि",
        adminTab: "👑 व्यवस्थापक",
        yourName: "आपका नाम",
        roomNumber: "कमरा संख्या",
        enterName: "अपना नाम दर्ज करें",
        loginGuest: "🔐 अतिथि लॉगिन",
        loginAdmin: "🔐 व्यवस्थापक लॉगिन",
        newRequest: "📝 नया अनुरोध",
        selectDepartment: "विभाग चुनें",
        selectService: "सेवा चुनें",
        submitRequest: "अनुरोध जमा करें",
        logout: "लॉगआउट",
        myRequests: "मेरे अनुरोध",
        pending: "लंबित",
        resolved: "हल किए गए",
        foodMenu: "🍕 फूड मेनू",
        transport: "🚗 ट्रांसपोर्ट",
        hotelInfo: "ℹ️ होटल जानकारी",
        save: "सहेजें",
        cancel: "रद्द करें",
        close: "बंद करें",
        copy: "कॉपी"
    });

    // Arabic translations
    Object.assign(translations.ar, {
        welcomeTitle: "فندق كراون بلازا",
        guestTab: "🏨 ضيف",
        adminTab: "👑 مسؤول",
        yourName: "اسمك",
        roomNumber: "رقم الغرفة",
        enterName: "أدخل اسمك",
        loginGuest: "🔐 تسجيل دخول ضيف",
        loginAdmin: "🔐 تسجيل دخول مسؤول",
        newRequest: "📝 طلب جديد",
        selectDepartment: "اختر القسم",
        selectService: "اختر الخدمة",
        submitRequest: "إرسال الطلب",
        logout: "تسجيل خروج",
        myRequests: "طلباتي",
        pending: "قيد الانتظار",
        resolved: "تم الحل",
        foodMenu: "🍕 قائمة الطعام",
        transport: "🚗 النقل",
        hotelInfo: "ℹ️ معلومات الفندق",
        save: "حفظ",
        cancel: "إلغاء",
        close: "إغلاق",
        copy: "نسخ"
    });

}

// ==========================================
// EXTENDING TRANSLATIONS WITH HINDI & ARABIC
// ==========================================
if (typeof translations !== 'undefined') {
    // Add Hindi translations if not exists
    if (!translations.hi) translations.hi = {};
    Object.assign(translations.hi, {
        welcomeTitle: "क्राउन प्लाज़ा होटल",
        guestTab: "🏨 अतिथि",
        adminTab: "👑 व्यवस्थापक",
        yourName: "आपका नाम",
        roomNumber: "कमरा संख्या",
        enterName: "अपना नाम दर्ज करें",
        loginGuest: "🔐 अतिथि लॉगिन",
        emailAddress: "ईमेल पता",
        password: "पासवर्ड",
        passwordPlaceholder: "••••••••",
        loginAdmin: "🔐 व्यवस्थापक लॉगिन",
        newRequest: "📝 नया अनुरोध",
        selectDepartment: "विभाग चुनें",
        selectService: "सेवा चुनें",
        describeIssue: "अपनी समस्या बताएं...",
        submitRequest: "अनुरोध जमा करें",
        sosEmergency: "🚨 SOS आपातकालीन",
        logout: "लॉगआउट",
        myRequests: "मेरे अनुरोध",
        pending: "लंबित",
        resolved: "हल किए गए",
        notRated: "रेटेड नहीं",
        foodMenu: "🍕 फूड मेनू",
        placeOrder: "ऑर्डर करें",
        transport: "🚗 ट्रांसपोर्ट",
        bookNow: "अभी बुक करें",
        hotelInfo: "ℹ️ होटल जानकारी",
        wifi: "📶 वाईफाई:",
        localTime: "🌍 स्थानीय समय:",
        restaurant: "🍽️ रेस्तरां:",
        gym: "💪 जिम:",
        emergency: "🚨 आपातकालीन:",
        checkout: "🕐 चेकआउट:",
        wakeUpCall: "⏰ वेक-अप कॉल सेट करें",
        dnd: "🔕 डीएनडी: बंद",
        localGuide: "🗺️ स्थानीय गाइड",
        events: "📅 इवेंट्स",
        emergencyContacts: "📞 आपातकालीन संपर्क",
        firstAid: "🚑 प्राथमिक उपचार",
        evacuationMap: "🗺️ निकासी मानचित्र",
        concierge: "🤖 कॉन्सियर्ज",
        checkoutRate: "⭐ चेकआउट और रेट करें",
        save: "सहेजें",
        cancel: "रद्द करें",
        close: "बंद करें",
        copy: "कॉपी",
        selectRole: "👑 अपनी भूमिका चुनें",
        roleSuperAdmin: "सुपर व्यवस्थापक",
        roleFrontDesk: "फ्रंट डेस्क",
        roleHousekeeping: "हाउसकीपिंग",
        roleMaintenance: "मेंटेनेंस",
        roleRestaurant: "रेस्तरां",
        roleLaundry: "लॉन्ड्री",
        roleSecurity: "सुरक्षा",
        roleIT: "आईटी सपोर्ट",
        back: "← वापस",
        liveUpdates: "लाइव अपडेट",
        voiceEnabled: "वॉइस सक्षम",
        pwaReady: "PWA तैयार",
        selectTheme: "थीम चुनें",
        offlineActive: "📴 ऑफ़लाइन मोड सक्रिय",
        highContrast: "🔆",
        fontSizeSmall: "A-",
        fontSizeReset: "A",
        fontSizeLarge: "A+",
        offlineMode: "📴",
        pushNotify: "🔔",
        haptic: "📳",
        darkMode: "🌙",
        langEN: "🇬🇧 EN",
        langHI: "🇮🇳 हिंदी",
        langAR: "🇸🇦 العربية",
        totalRooms: "कुल कमरे",
        occupied: "भरे हुए",
        open: "खुले",
        inProgress: "प्रगति पर",
        emergency: "आपातकालीन"
    });

    // Add Arabic translations
    if (!translations.ar) translations.ar = {};
    Object.assign(translations.ar, {
        welcomeTitle: "فندق كراون بلازا",
        guestTab: "🏨 ضيف",
        adminTab: "👑 مسؤول",
        yourName: "اسمك",
        roomNumber: "رقم الغرفة",
        enterName: "أدخل اسمك",
        loginGuest: "🔐 تسجيل دخول ضيف",
        emailAddress: "عنوان البريد الإلكتروني",
        password: "كلمة المرور",
        passwordPlaceholder: "••••••••",
        loginAdmin: "🔐 تسجيل دخول مسؤول",
        newRequest: "📝 طلب جديد",
        selectDepartment: "اختر القسم",
        selectService: "اختر الخدمة",
        describeIssue: "صف مشكلتك...",
        submitRequest: "إرسال الطلب",
        sosEmergency: "🚨 SOS طوارئ",
        logout: "تسجيل خروج",
        myRequests: "طلباتي",
        pending: "قيد الانتظار",
        resolved: "تم الحل",
        notRated: "لم يتم التقييم",
        foodMenu: "🍕 قائمة الطعام",
        placeOrder: "تقديم الطلب",
        transport: "🚗 النقل",
        bookNow: "احجز الآن",
        hotelInfo: "ℹ️ معلومات الفندق",
        wifi: "📶 الواي فاي:",
        localTime: "🌍 الوقت المحلي:",
        restaurant: "🍽️ المطعم:",
        gym: "💪 الصالة الرياضية:",
        emergency: "🚨 طوارئ:",
        checkout: "🕐 تسجيل الخروج:",
        wakeUpCall: "⏰ تعيين مكالمة إيقاظ",
        dnd: "🔕 عدم الإزعاج: إيقاف",
        localGuide: "🗺️ الدليل المحلي",
        events: "📅 الفعاليات",
        emergencyContacts: "📞 جهات اتصال الطوارئ",
        firstAid: "🚑 الإسعافات الأولية",
        evacuationMap: "🗺️ خريطة الإخلاء",
        concierge: "🤖 الكونسيرج",
        checkoutRate: "⭐ تسجيل الخروج والتقييم",
        save: "حفظ",
        cancel: "إلغاء",
        close: "إغلاق",
        copy: "نسخ",
        selectRole: "👑 اختر دورك",
        roleSuperAdmin: "مدير عام",
        roleFrontDesk: "مكتب الاستقبال",
        roleHousekeeping: "التنظيف",
        roleMaintenance: "الصيانة",
        roleRestaurant: "المطعم",
        roleLaundry: "الغسيل",
        roleSecurity: "الأمن",
        roleIT: "دعم تقنية المعلومات",
        back: "← عودة",
        liveUpdates: "تحديثات مباشرة",
        voiceEnabled: "تمكين الصوت",
        pwaReady: "PWA جاهز",
        selectTheme: "اختر سمة",
        offlineActive: "📴 وضع عدم الاتصال نشط",
        highContrast: "🔆",
        fontSizeSmall: "A-",
        fontSizeReset: "A",
        fontSizeLarge: "A+",
        offlineMode: "📴",
        pushNotify: "🔔",
        haptic: "📳",
        darkMode: "🌙",
        langEN: "🇬🇧 EN",
        langHI: "🇮🇳 हिंदी",
        langAR: "🇸🇦 العربية",
        totalRooms: "إجمالي الغرف",
        occupied: "مشغولة",
        open: "مفتوحة",
        inProgress: "قيد التنفيذ",
        emergency: "طارئ"
    });

    console.log("✅ Hindi and Arabic translations successfully added!");
}

// ========== AUTO-LOAD SAVED LANGUAGE ==========
(function() {
    const savedLang = localStorage.getItem('preferredLanguage');
    if (savedLang && savedLang !== 'en') {
        document.addEventListener('DOMContentLoaded', function() {
            setTimeout(() => {
                if (typeof window.changeLanguage === 'function') {
                    window.changeLanguage(savedLang);
                    console.log('✅ Auto-loaded language:', savedLang);
                }
            }, 200);
        });
    }
})();


// ========== SIMPLE ADMIN PANEL TRANSLATIONS ==========
// This works without breaking anything

// Hindi Admin Texts
const adminHindi = {
    tabOverview: "📊 अवलोकन",
    tabRequests: "📋 अनुरोध", 
    tabRooms: "🏨 कमरे",
    totalRooms: "कुल कमरे",
    occupied: "भरे हुए",
    open: "खुले",
    inProgress: "प्रगति पर",
    emergency: "आपातकालीन"
};

// Arabic Admin Texts  
const adminArabic = {
    tabOverview: "📊 نظرة عامة",
    tabRequests: "📋 الطلبات",
    tabRooms: "🏨 الغرف", 
    totalRooms: "إجمالي الغرف",
    occupied: "مشغولة",
    open: "مفتوحة",
    inProgress: "قيد التنفيذ",
    emergency: "طارئ"
};

// Safe translation function for admin panel
function translateAdminPanel(lang) {
    const texts = lang === 'hi' ? adminHindi : (lang === 'ar' ? adminArabic : null);
    if (!texts) return;

    for (const [key, value] of Object.entries(texts)) {
        const el = document.querySelector(`[data-i18n="${key}"]`);
        if (el) el.textContent = value;
    }
}

// Enhance changeLanguage without breaking
const originalChangeLang = window.changeLanguage;
window.changeLanguage = function(lang) {
    if (originalChangeLang) originalChangeLang(lang);
    setTimeout(() => translateAdminPanel(lang), 100);
};


// ========== LOGIN PAGE HINDI ONLY ==========
function loginPageHindi() {
    const hindi = {
        welcomeTitle: "क्राउन प्लाज़ा होटल",
        guestTab: "🏨 अतिथि",
        adminTab: "👑 व्यवस्थापक",
        yourName: "आपका नाम",
        roomNumber: "कमरा संख्या",
        enterName: "अपना नाम दर्ज करें",
        loginGuest: "🔐 अतिथि लॉगिन",
        loginAdmin: "🔐 व्यवस्थापक लॉगिन"
    };

    for (const [key, value] of Object.entries(hindi)) {
        const el = document.querySelector(`[data-i18n="${key}"]`);
        if (el) el.textContent = value;
    }

    const nameInput = document.querySelector('[data-i18n-placeholder="enterName"]');
    if (nameInput) nameInput.placeholder = "अपना नाम दर्ज करें";

    console.log('✅ Login page Hindi applied');
}

// Add to changeLanguage
const originalLang = window.changeLanguage;
window.changeLanguage = function(lang) {
    if (originalLang) originalLang(lang);
    if (lang === 'hi') {
        loginPageHindi();
    }
};

// ========== LOGIN PAGE ARABIC ONLY ==========
function loginPageArabic() {
    const arabic = {
        welcomeTitle: "فندق كراون بلازا",
        guestTab: "🏨 ضيف",
        adminTab: "👑 مسؤول",
        yourName: "اسمك",
        roomNumber: "رقم الغرفة",
        enterName: "أدخل اسمك",
        loginGuest: "🔐 تسجيل دخول ضيف",
        loginAdmin: "🔐 تسجيل دخول مسؤول"
    };

    for (const [key, value] of Object.entries(arabic)) {
        const el = document.querySelector(`[data-i18n="${key}"]`);
        if (el) el.textContent = value;
    }

    const nameInput = document.querySelector('[data-i18n-placeholder="enterName"]');
    if (nameInput) nameInput.placeholder = "أدخل اسمك";

    document.documentElement.dir = 'rtl';
    document.body.classList.add('rtl');

    console.log('✅ Login page Arabic applied');
}

// Add to changeLanguage (update existing)
const existingChange = window.changeLanguage;
window.changeLanguage = function(lang) {
    if (existingChange) existingChange(lang);

    if (lang === 'hi') {
        if (typeof loginPageHindi === 'function') loginPageHindi();
    } else if (lang === 'ar') {
        if (typeof loginPageArabic === 'function') loginPageArabic();
    }
};

// Auto-load saved language on page load
document.addEventListener('DOMContentLoaded', function() {
    const savedLang = localStorage.getItem('preferredLanguage');
    if (savedLang === 'hi') {
        setTimeout(function() {
            if (typeof loginPageHindi === 'function') loginPageHindi();
        }, 200);
    } else if (savedLang === 'ar') {
        setTimeout(function() {
            if (typeof loginPageArabic === 'function') loginPageArabic();
        }, 200);
    }
});

console.log('✅ Login page Arabic added permanently');

// ========== GUEST PAGE HINDI ONLY ==========
function guestPageHindi() {
    const hindi = {
        // Menu Buttons
        request: "अनुरोध",
        food: "खाना",
        cab: "कैब",
        history: "इतिहास",
        info: "जानकारी",

        // Stats
        myRequests: "मेरे अनुरोध",
        pending: "लंबित",
        resolved: "हल किए गए",
        notRated: "रेटेड नहीं",

        // Tab Headers
        newRequest: "📝 नया अनुरोध",
        foodMenu: "🍕 फूड मेनू",
        transport: "🚗 ट्रांसपोर्ट",
        hotelInfo: "ℹ️ होटल जानकारी",

        // Form
        selectDepartment: "विभाग चुनें",
        selectService: "सेवा चुनें",
        describeIssue: "अपनी समस्या बताएं...",
        submitRequest: "अनुरोध जमा करें",
        sosEmergency: "🚨 SOS आपातकालीन",

        // Buttons
        placeOrder: "ऑर्डर करें",
        bookNow: "अभी बुक करें",
        logout: "लॉगआउट",

        // Hotel Info
        wifi: "📶 वाईफाई:",
        localTime: "🌍 स्थानीय समय:",
        restaurant: "🍽️ रेस्तरां:",
        gym: "💪 जिम:",
        emergency: "🚨 आपातकालीन:",
        checkout: "🕐 चेकआउट:"
    };

    for (const [key, value] of Object.entries(hindi)) {
        const el = document.querySelector(`[data-i18n="${key}"]`);
        if (el) el.textContent = value;
    }

    // Department dropdown
    const dept = document.getElementById('guestDepartment');
    if (dept) {
        const opts = ["विभाग चुनें", "हाउसकीपिंग", "मेंटेनेंस", "रेस्तरां", "लॉन्ड्री", "आईटी सपोर्ट"];
        for (let i = 0; i < dept.options.length && i < opts.length; i++) {
            dept.options[i].text = opts[i];
        }
    }

    // Priority dropdown
    const prio = document.getElementById('guestPriority');
    if (prio) {
        if (prio.options[0]) prio.options[0].text = "सामान्य";
        if (prio.options[1]) prio.options[1].text = "⚠️ तत्काल";
    }

    console.log('✅ Guest page Hindi applied');
}

// Add to existing changeLanguage
const withGuestHindi = window.changeLanguage;
window.changeLanguage = function(lang) {
    if (withGuestHindi) withGuestHindi(lang);

    const guestDashboard = document.getElementById('guestDashboard');
    if (guestDashboard && !guestDashboard.classList.contains('hidden')) {
        if (lang === 'hi') {
            guestPageHindi();
        }
    }
};


// ========== GUEST PAGE ARABIC ONLY ==========
function guestPageArabic() {
    const arabic = {
        // Menu Buttons
        request: "طلب",
        food: "طعام",
        cab: "تاكسي",
        history: "السجل",
        info: "معلومات",

        // Stats
        myRequests: "طلباتي",
        pending: "قيد الانتظار",
        resolved: "تم الحل",
        notRated: "لم يتم التقييم",

        // Tab Headers
        newRequest: "📝 طلب جديد",
        foodMenu: "🍕 قائمة الطعام",
        transport: "🚗 النقل",
        hotelInfo: "ℹ️ معلومات الفندق",

        // Form
        selectDepartment: "اختر القسم",
        selectService: "اختر الخدمة",
        describeIssue: "صف مشكلتك...",
        submitRequest: "إرسال الطلب",
        sosEmergency: "🚨 SOS طوارئ",

        // Buttons
        placeOrder: "تقديم الطلب",
        bookNow: "احجز الآن",
        logout: "تسجيل خروج",

        // Hotel Info
        wifi: "📶 الواي فاي:",
        localTime: "🌍 الوقت المحلي:",
        restaurant: "🍽️ المطعم:",
        gym: "💪 الصالة الرياضية:",
        emergency: "🚨 طوارئ:",
        checkout: "🕐 تسجيل الخروج:"
    };

    for (const [key, value] of Object.entries(arabic)) {
        const el = document.querySelector(`[data-i18n="${key}"]`);
        if (el) el.textContent = value;
    }

    // Department dropdown
    const dept = document.getElementById('guestDepartment');
    if (dept) {
        const opts = ["اختر القسم", "التنظيف", "الصيانة", "المطعم", "الغسيل", "دعم تقنية المعلومات"];
        for (let i = 0; i < dept.options.length && i < opts.length; i++) {
            dept.options[i].text = opts[i];
        }
    }

    // Priority dropdown
    const prio = document.getElementById('guestPriority');
    if (prio) {
        if (prio.options[0]) prio.options[0].text = "عادي";
        if (prio.options[1]) prio.options[1].text = "⚠️ عاجل";
    }

    // Set RTL
    document.documentElement.dir = 'rtl';
    document.body.classList.add('rtl');

    console.log('✅ Guest page Arabic applied');
}

// Add to existing changeLanguage
const withGuestArabic = window.changeLanguage;
window.changeLanguage = function(lang) {
    if (withGuestArabic) withGuestArabic(lang);

    const guestDashboard = document.getElementById('guestDashboard');
    if (guestDashboard && !guestDashboard.classList.contains('hidden')) {
        if (lang === 'hi') {
            if (typeof guestPageHindi === 'function') guestPageHindi();
        } else if (lang === 'ar') {
            if (typeof guestPageArabic === 'function') guestPageArabic();
        }
    }
};


// ========== FIX DEPARTMENT DROPDOWN ARABIC ==========
function fixDepartmentArabic() {
    const dept = document.getElementById('guestDepartment');
    if (dept) {
        const arabicOptions = [
            "اختر القسم",
            "التنظيف",
            "الصيانة",
            "المطعم",
            "الغسيل",
            "دعم تقنية المعلومات"
        ];
        for (let i = 0; i < dept.options.length && i < arabicOptions.length; i++) {
            dept.options[i].text = arabicOptions[i];
        }
        console.log('✅ Department dropdown fixed to Arabic');
    }

    // Fix priority dropdown too
    const prio = document.getElementById('guestPriority');
    if (prio) {
        if (prio.options[0]) prio.options[0].text = "عادي";
        if (prio.options[1]) prio.options[1].text = "⚠️ عاجل";
        console.log('✅ Priority dropdown fixed to Arabic');
    }
}

// Add to guestPageArabic function
const originalGuestArabic = guestPageArabic;
if (typeof guestPageArabic === 'function') {
    window.guestPageArabic = function() {
        if (originalGuestArabic) originalGuestArabic();
        fixDepartmentArabic();
    };
} else {
    window.guestPageArabic = fixDepartmentArabic;
}

// Also add to changeLanguage for Arabic
const arabicDeptChange = window.changeLanguage;
window.changeLanguage = function(lang) {
    if (arabicDeptChange) arabicDeptChange(lang);

    if (lang === 'ar') {
        setTimeout(function() {
            fixDepartmentArabic();
        }, 100);
    }
};

console.log('✅ Department dropdown Arabic fix ready');

// ========== ADMIN PANEL HINDI ONLY ==========
function adminPanelHindi() {
    const hindi = {
        tabOverview: "📊 अवलोकन",
        tabRequests: "📋 अनुरोध",
        tabRooms: "🏨 कमरे",
        totalRooms: "कुल कमरे",
        occupied: "भरे हुए",
        open: "खुले",
        inProgress: "प्रगति पर",
        emergency: "आपातकालीन",
        addNewRoom: "+ नया कमरा जोड़ें",
        save: "सहेजें",
        cancel: "रद्द करें",
        delete: "हटाएं",
        close: "बंद करें"
    };

    for (const [key, value] of Object.entries(hindi)) {
        const el = document.querySelector(`[data-i18n="${key}"]`);
        if (el) el.textContent = value;
    }
    console.log('✅ Admin panel Hindi applied');
}

// Add to changeLanguage
const withAdminHindi = window.changeLanguage;
window.changeLanguage = function(lang) {
    if (withAdminHindi) withAdminHindi(lang);

    const adminDash = document.getElementById('adminDashboard');
    if (adminDash && !adminDash.classList.contains('hidden')) {
        if (lang === 'hi') {
            adminPanelHindi();
        }
    }
};


// ========== ADMIN PANEL ARABIC ONLY ==========
function adminPanelArabic() {
    const arabic = {
        tabOverview: "📊 نظرة عامة",
        tabRequests: "📋 الطلبات",
        tabRooms: "🏨 الغرف",
        totalRooms: "إجمالي الغرف",
        occupied: "مشغولة",
        open: "مفتوحة",
        inProgress: "قيد التنفيذ",
        emergency: "طارئ",
        addNewRoom: "+ إضافة غرفة جديدة",
        save: "حفظ",
        cancel: "إلغاء",
        delete: "حذف",
        close: "إغلاق"
    };

    for (const [key, value] of Object.entries(arabic)) {
        const el = document.querySelector(`[data-i18n="${key}"]`);
        if (el) el.textContent = value;
    }

    document.documentElement.dir = 'rtl';
    document.body.classList.add('rtl');

    console.log('✅ Admin panel Arabic applied');
}

// Add to changeLanguage
const withAdminArabic = window.changeLanguage;
window.changeLanguage = function(lang) {
    if (withAdminArabic) withAdminArabic(lang);

    const adminDash = document.getElementById('adminDashboard');
    if (adminDash && !adminDash.classList.contains('hidden')) {
        if (lang === 'hi') {
            adminPanelHindi();
        } else if (lang === 'ar') {
            adminPanelArabic();
        }
    }
};


// ========== ADMIN PANEL DEPARTMENT DROPDOWN ARABIC ==========
function fixAdminDepartmentArabic() {
    const adminDept = document.getElementById('reqDepartment');
    if (adminDept) {
        const arabicOptions = [
            "اختر القسم",
            "التنظيف",
            "الصيانة",
            "المطعم",
            "الغسيل",
            "دعم تقنية المعلومات"
        ];
        for (let i = 0; i < adminDept.options.length && i < arabicOptions.length; i++) {
            adminDept.options[i].text = arabicOptions[i];
        }
        console.log('✅ Admin department dropdown fixed to Arabic');
    }

    // Fix admin priority dropdown too
    const adminPrio = document.getElementById('reqPriority');
    if (adminPrio) {
        const priorityOptions = [
            "منخفض",
            "متوسط",
            "عالي",
            "🚨 طارئ"
        ];
        for (let i = 0; i < adminPrio.options.length && i < priorityOptions.length; i++) {
            adminPrio.options[i].text = priorityOptions[i];
        }
        console.log('✅ Admin priority dropdown fixed to Arabic');
    }
}

// Add to adminPanelArabic function
const existingAdminArabic = adminPanelArabic;
if (typeof adminPanelArabic === 'function') {
    window.adminPanelArabic = function() {
        if (existingAdminArabic) existingAdminArabic();
        fixAdminDepartmentArabic();
    };
}

// Also add to changeLanguage for Arabic
const adminDeptChange = window.changeLanguage;
window.changeLanguage = function(lang) {
    if (adminDeptChange) adminDeptChange(lang);

    const adminDash = document.getElementById('adminDashboard');
    if (adminDash && !adminDash.classList.contains('hidden')) {
        if (lang === 'ar') {
            setTimeout(function() {
                fixAdminDepartmentArabic();
            }, 100);
        }
    }
};




function fixAdminArabicDropdowns() {
    const adminDept = document.getElementById('reqDepartment');
    if (adminDept) {
        const deptOptions = ["اختر القسم", "التنظيف", "الصيانة", "المطعم", "الغسيل", "دعم تقنية المعلومات"];
        for (let i = 0; i < adminDept.options.length && i < deptOptions.length; i++) {
            adminDept.options[i].text = deptOptions[i];
        }
    }
    const adminPrio = document.getElementById('reqPriority');
    if (adminPrio) {
        const priorityOptions = ["منخفض", "متوسط", "عالي", "🚨 طارئ"];
        for (let i = 0; i < adminPrio.options.length && i < priorityOptions.length; i++) {
            adminPrio.options[i].text = priorityOptions[i];
        }
    }
    console.log('✅ Admin Arabic dropdowns fixed');
}

const safeChangeLang = window.changeLanguage;
window.changeLanguage = function(lang) {
    if (safeChangeLang) safeChangeLang(lang);
    if (lang === 'ar') {
        setTimeout(fixAdminArabicDropdowns, 200);
    }
};


// ========== FIX ADMIN DEPARTMENT ARABIC IN HTML ==========
function fixAdminDeptArabic() {
    const adminDept = document.getElementById('reqDepartment');
    if (adminDept && translations.ar) {
        const deptMap = {
            "": "اختر القسم",
            "housekeeping": "التنظيف",
            "maintenance": "الصيانة",
            "restaurant": "المطعم",
            "laundry": "الغسيل",
            "it": "دعم تقنية المعلومات"
        };

        for (let i = 0; i < adminDept.options.length; i++) {
            const val = adminDept.options[i].value;
            if (deptMap[val]) {
                adminDept.options[i].text = deptMap[val];
            }
        }
    }
}

// Add to existing changeLanguage
if (typeof changeLanguage === 'function') {
    const originalChange = changeLanguage;
    window.changeLanguage = function(lang) {
        originalChange(lang);
        if (lang === 'ar') {
            setTimeout(fixAdminDeptArabic, 100);
        }
    };
}
