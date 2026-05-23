(function() {
    const blockedKeys = [
        'crown_plaza_requests', 'crown_plaza_rooms', 'crown_plaza_guests',
        'crown_plaza_reviews', 'crown_plaza_inventory', 'crown_plaza_maintenance',
        'crown_plaza_blacklist', 'crown_plaza_loyalty', 'crown_plaza_staff',
        'crown_plaza_foodmenu', 'crown_plaza_activity_logs', 'crown_plaza_currentAdmin',
        'crown_plaza_currentGuest', 'crown_plaza_currentRole', 'crown_plaza_page_state',
        'crown_plaza_brightness', 'crown_plaza_offlineMode'
    ];
    
    blockedKeys.forEach(key => localStorage.removeItem(key));
    
    const origSet = localStorage.setItem;
    localStorage.setItem = function(k, v) {
        if (blockedKeys.includes(k)) {
            console.warn(`🔒 Blocked: ${k} - Use MongoDB`);
            return;
        }
        origSet.call(localStorage, k, v);
    };
    
    console.log('✅ MongoDB only mode active');
})();
