-- Guest Hub Module Tables
-- Created: 2026

-- 1. Hotel Settings Table
CREATE TABLE hotel_settings (
    id INT PRIMARY KEY AUTO_INCREMENT,
    hotel_id VARCHAR(50) NOT NULL,
    support_phone VARCHAR(20),
    support_email VARCHAR(100),
    whatsapp_number VARCHAR(20),
    upi_id VARCHAR(100),
    qr_code_url TEXT,
    payment_gateway VARCHAR(50) DEFAULT 'razorpay',
    enabled_payment_methods JSON,
    currencies VARCHAR(255) DEFAULT 'INR, USD, EUR, GBP',
    tax_percentage DECIMAL(5,2) DEFAULT 18.00,
    service_charge_percentage DECIMAL(5,2) DEFAULT 10.00,
    auto_generate_bill BOOLEAN DEFAULT TRUE,
    bill_generation_time ENUM('checkout', 'daily', 'weekly') DEFAULT 'checkout',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_hotel_id (hotel_id)
);

-- 2. AI Settings Table
CREATE TABLE hotel_ai_settings (
    id INT PRIMARY KEY AUTO_INCREMENT,
    hotel_id VARCHAR(50) NOT NULL,
    ai_enabled BOOLEAN DEFAULT TRUE,
    ai_provider ENUM('openai', 'google', 'custom') DEFAULT 'custom',
    api_key VARCHAR(255),
    custom_responses JSON,
    faq_json JSON,
    language_support JSON DEFAULT '["en", "ar"]',
    default_language VARCHAR(10) DEFAULT 'en',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_hotel_id (hotel_id)
);

-- 3. Chat History Table
CREATE TABLE chat_history (
    id INT PRIMARY KEY AUTO_INCREMENT,
    hotel_id VARCHAR(50) NOT NULL,
    guest_id VARCHAR(50) NOT NULL,
    user_message TEXT NOT NULL,
    bot_response TEXT NOT NULL,
    language VARCHAR(10) DEFAULT 'en',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_hotel_guest (hotel_id, guest_id),
    INDEX idx_created_at (created_at)
);

-- 4. Support Tickets Table
CREATE TABLE support_tickets (
    id INT PRIMARY KEY AUTO_INCREMENT,
    ticket_id VARCHAR(50) UNIQUE NOT NULL,
    hotel_id VARCHAR(50) NOT NULL,
    guest_id VARCHAR(50) NOT NULL,
    description TEXT NOT NULL,
    category VARCHAR(50) DEFAULT 'general',
    priority ENUM('low', 'normal', 'urgent', 'emergency') DEFAULT 'normal',
    status ENUM('open', 'in_progress', 'resolved', 'closed') DEFAULT 'open',
    assigned_to INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP NULL,
    INDEX idx_ticket_id (ticket_id),
    INDEX idx_hotel_guest (hotel_id, guest_id),
    INDEX idx_status (status)
);

-- 5. Ticket Updates Table
CREATE TABLE ticket_updates (
    id INT PRIMARY KEY AUTO_INCREMENT,
    ticket_id INT NOT NULL,
    message TEXT NOT NULL,
    sender_type ENUM('guest', 'staff', 'system') NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE,
    INDEX idx_ticket_id (ticket_id)
);

-- 6. Payments Table
CREATE TABLE payments (
    id INT PRIMARY KEY AUTO_INCREMENT,
    hotel_id VARCHAR(50) NOT NULL,
    guest_id VARCHAR(50) NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    payment_method VARCHAR(50) NOT NULL,
    transaction_id VARCHAR(100),
    status ENUM('pending', 'completed', 'failed', 'refunded') DEFAULT 'pending',
    currency VARCHAR(10) DEFAULT 'INR',
    gateway_response JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_hotel_guest (hotel_id, guest_id),
    INDEX idx_transaction_id (transaction_id),
    INDEX idx_status (status)
);

-- 7. Bills Table
CREATE TABLE bills (
    id INT PRIMARY KEY AUTO_INCREMENT,
    hotel_id VARCHAR(50) NOT NULL,
    guest_id VARCHAR(50) NOT NULL,
    total_amount DECIMAL(10,2) NOT NULL,
    tax_amount DECIMAL(10,2) DEFAULT 0,
    service_charge DECIMAL(10,2) DEFAULT 0,
    status ENUM('pending', 'paid', 'cancelled') DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_hotel_guest (hotel_id, guest_id),
    INDEX idx_status (status)
);

-- 8. Bill Items Table
CREATE TABLE bill_items (
    id INT PRIMARY KEY AUTO_INCREMENT,
    bill_id INT NOT NULL,
    item_name VARCHAR(255) NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    quantity INT DEFAULT 1,
    category VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE,
    INDEX idx_bill_id (bill_id)
);

-- 9. Service Requests Table
CREATE TABLE service_requests (
    id INT PRIMARY KEY AUTO_INCREMENT,
    hotel_id VARCHAR(50) NOT NULL,
    guest_id VARCHAR(50) NOT NULL,
    service_type VARCHAR(50) NOT NULL,
    description TEXT,
    priority ENUM('normal', 'urgent', 'emergency') DEFAULT 'normal',
    status ENUM('pending', 'accepted', 'in_progress', 'completed', 'cancelled') DEFAULT 'pending',
    assigned_to INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    completed_at TIMESTAMP NULL,
    INDEX idx_hotel_guest (hotel_id, guest_id),
    INDEX idx_status (status)
);

-- 10. Guest Preferences Table
CREATE TABLE guest_preferences (
    id INT PRIMARY KEY AUTO_INCREMENT,
    hotel_id VARCHAR(50) NOT NULL,
    guest_id VARCHAR(50) NOT NULL,
    language VARCHAR(10) DEFAULT 'en',
    notifications BOOLEAN DEFAULT TRUE,
    preferences_json JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_guest (hotel_id, guest_id)
);

-- 11. Hotel Payment Settings Table
CREATE TABLE hotel_payment_settings (
    id INT PRIMARY KEY AUTO_INCREMENT,
    hotel_id VARCHAR(50) NOT NULL,
    payment_method VARCHAR(50) NOT NULL,
    upi_id VARCHAR(100),
    upi_qr_code TEXT,
    api_key VARCHAR(255),
    secret_key VARCHAR(255),
    is_enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_hotel_method (hotel_id, payment_method)
);

-- 12. Analytics Table (for tracking)
CREATE TABLE guest_hub_analytics (
    id INT PRIMARY KEY AUTO_INCREMENT,
    hotel_id VARCHAR(50) NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    event_data JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_hotel_event (hotel_id, event_type),
    INDEX idx_created_at (created_at)
);

-- Insert Default Settings (Example)
INSERT INTO hotel_settings (
    hotel_id, 
    support_phone, 
    support_email, 
    whatsapp_number,
    enabled_payment_methods
) VALUES (
    'HOTEL002',
    '+91-9876543210',
    'support@mariyahotel.com',
    '+91-9876543210',
    '["upi", "card", "cash"]'
);

INSERT INTO hotel_ai_settings (
    hotel_id,
    custom_responses,
    faq_json
) VALUES (
    'HOTEL002',
    '{}',
    '{}'
);
