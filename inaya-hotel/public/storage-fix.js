// ============ STORAGE STRATEGY ============
// Settings/Themes -> LocalStorage (User preferences)
// Business Data -> MongoDB (Persistent, cross-device)

// Block data storage in localStorage
const blockedKeys = [
    'crown_plaza_requests', 'crown_plaza_rooms', 'crown_plaza_guests',
    'crown_plaza_reviews', 'crown_plaza_inventory', 'crown_plaza_maintenance',
    'crown_plaza_blacklist', 'crown_plaza_loyalty', 'crown_plaza_staff',
    'crown_plaza_foodmenu', 'crown_plaza_activity_logs'
];

// Override localStorage for data only
const originalSetItem = localStorage.setItem;
localStorage.setItem = function(key, value) {
    if (blockedKeys.includes(key)) {
        console.log(`⚠️ Blocked: ${key} - Use MongoDB instead`);
        return;
    }
    originalSetItem.call(localStorage, key, value);
};

// Allow settings to be read from localStorage
const originalGetItem = localStorage.getItem;
localStorage.getItem = function(key) {
    if (blockedKeys.includes(key)) {
        return null; // Force reload from MongoDB
    }
    return originalGetItem.call(localStorage, key);
};

console.log('✅ Settings in LocalStorage | Data in MongoDB');
