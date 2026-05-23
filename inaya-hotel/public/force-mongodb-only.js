// ============ FORCE MONGODB ONLY - BLOCK ALL DATA LOCALSTORAGE ============
(function() {
    // List of keys to block (business data)
    const blockedDataKeys = [
        'crown_plaza_requests', 'crown_plaza_rooms', 'crown_plaza_guests',
        'crown_plaza_reviews', 'crown_plaza_inventory', 'crown_plaza_maintenance',
        'crown_plaza_blacklist', 'crown_plaza_loyalty', 'crown_plaza_staff',
        'crown_plaza_foodmenu', 'crown_plaza_activity_logs', 'crown_plaza_currentAdmin',
        'crown_plaza_currentGuest', 'crown_plaza_currentRole', 'crown_plaza_page_state',
        'crown_plaza_brightness', 'crown_plaza_offlineMode'
    ];
    
    // Allowed keys (user preferences only)
    const allowedKeys = [
        'crown_plaza_theme', 'crown_plaza_darkMode', 'preferredLanguage',
        'crown_plaza_settings', 'hqms_darkMode', 'hqms_theme', 'hqms_language'
    ];
    
    // Save original methods
    const originalSetItem = localStorage.setItem;
    const originalGetItem = localStorage.getItem;
    const originalRemoveItem = localStorage.removeItem;
    
    // Override setItem
    localStorage.setItem = function(key, value) {
        if (blockedDataKeys.includes(key)) {
            console.warn(`🔒 BLOCKED: "${key}" cannot be saved to localStorage. Use MongoDB instead.`);
            return;
        }
        if (allowedKeys.includes(key)) {
            console.log(`✅ Allowed: "${key}" saved to localStorage (user preference)`);
        }
        originalSetItem.call(localStorage, key, value);
    };
    
    // Override getItem
    localStorage.getItem = function(key) {
        if (blockedDataKeys.includes(key)) {
            console.warn(`🔒 BLOCKED: Reading "${key}" from localStorage blocked. Use MongoDB.`);
            return null;
        }
        return originalGetItem.call(localStorage, key);
    };
    
    // Clear any existing blocked data
    blockedDataKeys.forEach(key => {
        if (originalGetItem.call(localStorage, key)) {
            originalRemoveItem.call(localStorage, key);
            console.log(`🧹 Cleared existing "${key}" from localStorage`);
        }
    });
    
    console.log('✅ Data Storage: MongoDB | Preferences: LocalStorage');
})();
