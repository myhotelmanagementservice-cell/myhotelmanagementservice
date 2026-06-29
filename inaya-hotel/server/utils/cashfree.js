// server/utils/cashfree.js
// Cashfree Token Management & API Helper

const crypto = require('crypto');

// Token cache (in-memory, production mein Redis use karo)
let tokenCache = {
    token: null,
    expiresAt: null
};

const CASHFREE_BASE_URL = process.env.CASHFREE_ENVIRONMENT === 'production'
    ? 'https://api.cashfree.com/pg'
    : 'https://sandbox.cashfree.com/pg';

const CASHFREE_AUTHORIZE_URL = process.env.CASHFREE_ENVIRONMENT === 'production'
    ? 'https://api.cashfree.com/pg/authorize'
    : 'https://sandbox.cashfree.com/pg/authorize';

/**
 * Generate Bearer Token from Cashfree
 * Uses X-Client-Id and X-Client-Secret to get temporary token
 */
async function generateBearerToken() {
    try {
        console.log('🔑 Generating Cashfree Bearer Token...');
        
        const response = await fetch(CASHFREE_AUTHORIZE_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-version': '2023-08-01',
                'x-client-id': process.env.CASHFREE_APP_ID,
                'x-client-secret': process.env.CASHFREE_SECRET_KEY
            },
            body: JSON.stringify({})
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Token generation failed: ${errorData.message || response.statusText}`);
        }

        const data = await response.json();
        
        // Cache token with expiry (subtract 5 minutes for safety margin)
        const expiresAt = new Date(Date.now() + (data.expires_in - 300) * 1000);
        
        tokenCache = {
            token: data.token,
            expiresAt: expiresAt
        };

        console.log('✅ Bearer Token generated successfully');
        console.log(`   Expires at: ${expiresAt.toISOString()}`);
        
        return data.token;
    } catch (error) {
        console.error('❌ Token generation error:', error.message);
        throw error;
    }
}

/**
 * Get valid Bearer Token (auto-refresh if expired)
 */
async function getBearerToken() {
    const now = new Date();
    
    // Check if token exists and not expired
    if (tokenCache.token && tokenCache.expiresAt && tokenCache.expiresAt > now) {
        console.log('♻️  Using cached Bearer Token');
        return tokenCache.token;
    }
    
    // Token expired or doesn't exist - generate new one
    console.log('🔄 Token expired or missing, generating new token...');
    return await generateBearerToken();
}

/**
 * Make authenticated API call to Cashfree
 * Automatically handles token refresh
 */
async function cashfreeApiCall(endpoint, method = 'GET', body = null) {
    try {
        const token = await getBearerToken();
        
        const headers = {
            'Content-Type': 'application/json',
            'x-api-version': '2023-08-01',
            'Authorization': `Bearer ${token}`
        };

        const options = {
            method,
            headers
        };

        if (body && method !== 'GET') {
            options.body = JSON.stringify(body);
        }

        const url = `${CASHFREE_BASE_URL}${endpoint}`;
        console.log(`📡 Cashfree API Call: ${method} ${endpoint}`);

        const response = await fetch(url, options);
        const data = await response.json();

        // Handle token expiration
        if (response.status === 401 && data.message?.includes('token')) {
            console.warn('⚠️  Token expired, regenerating...');
            tokenCache = { token: null, expiresAt: null }; // Clear cache
            
            // Retry with new token
            const newToken = await generateBearerToken();
            headers['Authorization'] = `Bearer ${newToken}`;
            
            const retryResponse = await fetch(url, options);
            return await retryResponse.json();
        }

        return data;
    } catch (error) {
        console.error('❌ Cashfree API call error:', error.message);
        throw error;
    }
}

/**
 * Generate signature for webhook verification
 * Uses same secret key (no separate webhook secret)
 */
function verifyWebhookSignature(signature, timestamp, body) {
    try {
        if (!signature || !timestamp || !body) {
            console.error('❌ Missing signature, timestamp, or body');
            return false;
        }
        
        // Step 1: Concatenate timestamp + rawBody
        const payload = timestamp + body;
        
        // Step 2: Create HMAC-SHA256 hash with secret key
        const generatedSignature = crypto
            .createHmac('sha256', process.env.CASHFREE_SECRET_KEY)
            .update(payload)
            .digest('base64');  // ✅ Base64 (NOT hex)
        
        // Step 3: Compare signatures
        const isValid = signature === generatedSignature;
        
        if (!isValid) {
            console.error('❌ Webhook signature mismatch');
            console.error('   Expected:', signature);
            console.error('   Generated:', generatedSignature);
        }
        
        return isValid;
    } catch (error) {
        console.error('❌ Webhook signature verification error:', error.message);
        return false;
    }
}

/**
 * Create Cashfree Order with Bearer Token
 */
async function createOrder(orderPayload) {
    return await cashfreeApiCall('/orders', 'POST', orderPayload);
}

/**
 * Get Order Status with Bearer Token
 */
async function getOrderStatus(orderId) {
    return await cashfreeApiCall(`/orders/${orderId}`, 'GET');
}

/**
 * Capture Payment with Bearer Token
 */
async function capturePayment(orderId, amount) {
    return await cashfreeApiCall(`/orders/${orderId}/capture`, 'POST', { amount });
}

module.exports = {
    generateBearerToken,
    getBearerToken,
    cashfreeApiCall,
    verifyWebhookSignature,
    createOrder,
    getOrderStatus,
    capturePayment,
    CASHFREE_BASE_URL,
    CASHFREE_AUTHORIZE_URL
};
