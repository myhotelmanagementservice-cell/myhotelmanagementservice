// Global Variables
let currentLang = 'en';
let currentTab = 'payments';
let hotelId = 'HOTEL002';
let guestId = null;

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    initializeGuestHub();
});

async function initializeGuestHub() {
    // Get guest ID from URL or session
    const urlParams = new URLSearchParams(window.location.search);
    guestId = urlParams.get('guestId') || sessionStorage.getItem('guestId');
    hotelId = urlParams.get('hotelId') || 'HOTEL002';

    if (!guestId) {
        showToast('Guest ID not found', 'error');
        return;
    }

    // Load initial data
    await loadBillData();
    await loadPaymentHistory();
    await loadTickets();
    await loadHotelSettings();
}

// Tab Switching
function switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(`${tabName}-tab`).classList.add('active');

    currentTab = tabName;
}

// Bill Management
async function loadBillData() {
    try {
        showLoading(true);
        const response = await fetch(`/api/guest-hub/bill?hotelId=${hotelId}&guestId=${guestId}`);
        const data = await response.json();

        if (data.success) {
            updateBillDisplay(data.bill);
        } else {
            showToast('Failed to load bill', 'error');
        }
    } catch (error) {
        console.error('Error loading bill:', error);
        showToast('Error loading bill', 'error');
    } finally {
        showLoading(false);
    }
}

function updateBillDisplay(bill) {
    document.getElementById('totalBill').textContent = bill.total.toFixed(2);

    const breakdownHTML = bill.items.map(item => `
        <div class="bill-item">
            <span>${item.name}</span>
            <span>₹${item.amount.toFixed(2)}</span>
        </div>
    `).join('');

    document.getElementById('billBreakdown').innerHTML = breakdownHTML;
}

// Payment Methods
function showPaymentMethods() {
    document.getElementById('paymentModal').classList.add('active');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

// UPI Payment
async function payWithUPI(method) {
    closeModal('paymentModal');

    try {
        const response = await fetch(`/api/payment/upi-details?hotelId=${hotelId}`);
        const data = await response.json();

        if (data.success) {
            document.getElementById('hotelUPI').textContent = data.upiId;
            document.getElementById('upiQRCode').src = data.qrCode;

            // Show appropriate section
            document.getElementById('qrCodeSection').style.display = 'block';
            document.getElementById('upiIdSection').style.display = 'none';
            document.getElementById('upiAppsSection').style.display = 'none';

            if (method === 'id') {
                document.getElementById('qrCodeSection').style.display = 'none';
                document.getElementById('upiIdSection').style.display = 'block';
            } else if (method === 'apps') {
                document.getElementById('qrCodeSection').style.display = 'none';
                document.getElementById('upiAppsSection').style.display = 'block';
            }

            document.getElementById('upiModal').classList.add('active');
        }
    } catch (error) {
        showToast('Error loading UPI details', 'error');
    }
}

function openUPIApp(appName) {
    const upiId = document.getElementById('hotelUPI').textContent;
    const amount = document.getElementById('totalBill').textContent;

    let appUrl = '';
    switch(appName) {
        case 'gpay':
            appUrl = `tez://upi/pay?pa=${upiId}&pn=Hotel&am=${amount}`;
            break;
        case 'phonepe':
            appUrl = `phonepe://pay?pa=${upiId}&pn=Hotel&am=${amount}`;
            break;
        case 'paytm':
            appUrl = `paytmmp://pay?pa=${upiId}&pn=Hotel&am=${amount}`;
            break;
        case 'bhim':
            appUrl = `bhim://upi/pay?pa=${upiId}&pn=Hotel&am=${amount}`;
            break;
    }

    window.location.href = appUrl;
}

function sendPaymentRequest() {
    const guestUPI = document.getElementById('guestUPI').value;
    if (!guestUPI) {
        showToast('Please enter UPI ID', 'error');
        return;
    }

    // Send payment request logic
    showToast('Payment request sent!', 'success');
    closeModal('upiModal');
}

// International Payments
function payWithCard() {
    showToast('Card payment gateway opening...', 'success');
    // Integrate Stripe/Razorpay here
}

function payWithWallet(wallet) {
    showToast(`${wallet} payment opening...`, 'success');
    // Integrate wallet payment here
}

// Payment History
async function loadPaymentHistory() {
    try {
        const response = await fetch(`/api/payment/history?hotelId=${hotelId}&guestId=${guestId}`);
        const data = await response.json();

        if (data.success) {
            const historyHTML = data.payments.map(payment => `
                <div class="history-item">
                    <div>
                        <div style="font-weight: bold;">${payment.method}</div>
                        <div style="font-size: 0.875rem; color: var(--text-secondary);">
                            ${new Date(payment.date).toLocaleString()}
                        </div>
                    </div>
                    <div style="color: var(--secondary-color); font-weight: bold;">
                        ₹${payment.amount.toFixed(2)}
                    </div>
                </div>
            `).join('');

            document.getElementById('paymentHistory').innerHTML = historyHTML;
        }
    } catch (error) {
        console.error('Error loading payment history:', error);
    }
}

// AI Chat
function handleChatKeypress(event) {
    if (event.key === 'Enter') {
        sendMessage();
    }
}

async function sendMessage() {
    const input = document.getElementById('chatInput');
    const message = input.value.trim();

    if (!message) return;

    // Add user message
    addMessage(message, 'user');
    input.value = '';

    // Get AI response
    try {
        showLoading(true);
        const response = await fetch('/api/ai-chat/message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                hotelId,
                guestId,
                message,
                language: currentLang
            })
        });

        const data = await response.json();
        if (data.success) {
            addMessage(data.reply, 'bot');
        }
    } catch (error) {
        addMessage('Sorry, I encountered an error. Please try again.', 'bot');
    } finally {
        showLoading(false);
    }
}

function addMessage(text, sender) {
    const messagesContainer = document.getElementById('chatMessages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}-message`;
    messageDiv.innerHTML = `
        <div class="message-content">${text}</div>
    `;
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function quickQuery(type) {
    const queries = {
        bill: 'What is my current bill?',
        checkout: 'I want to checkout',
        services: 'What services are available?',
        wifi: 'What is the WiFi password?'
    };

    document.getElementById('chatInput').value = queries[type];
    sendMessage();
}

// Voice Input
function startVoiceInput() {
    if ('webkitSpeechRecognition' in window) {
        const recognition = new webkitSpeechRecognition();
        recognition.lang = currentLang === 'ar' ? 'ar-SA' : 'en-US';

        recognition.onresult = function(event) {
            const transcript = event.results[0][0].transcript;
            document.getElementById('chatInput').value = transcript;
        };

        recognition.start();
        showToast('Listening...', 'success');
    } else {
        showToast('Voice input not supported', 'error');
    }
}

// Support Functions
function startLiveChat() {
    showToast('Connecting to live chat...', 'success');
    // Implement WebSocket or third-party chat
}

function makeSupportCall() {
    window.location.href = 'tel:+91XXXXXXXXXX';
}

function raiseTicket() {
    const description = prompt('Please describe your issue:');
    if (description) {
        submitTicket(description);
    }
}

async function submitTicket(description) {
    try {
        const response = await fetch('/api/tickets/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                hotelId,
                guestId,
                description,
                priority: 'normal'
            })
        });

        const data = await response.json();
        if (data.success) {
            showToast('Ticket created successfully!', 'success');
            loadTickets();
        }
    } catch (error) {
        showToast('Error creating ticket', 'error');
    }
}

async function loadTickets() {
    try {
        const response = await fetch(`/api/tickets/list?hotelId=${hotelId}&guestId=${guestId}`);
        const data = await response.json();

        if (data.success) {
            const ticketsHTML = data.tickets.map(ticket => `
                <div class="ticket-item">
                    <div>
                        <div style="font-weight: bold;">#${ticket.id}</div>
                        <div style="font-size: 0.875rem;">${ticket.description}</div>
                        <div style="font-size: 0.75rem; color: var(--text-secondary);">
                            ${new Date(ticket.createdAt).toLocaleString()}
                        </div>
                    </div>
                    <div class="status ${ticket.status}">${ticket.status}</div>
                </div>
            `).join('');

            document.getElementById('ticketsList').innerHTML = ticketsHTML;
        }
    } catch (error) {
        console.error('Error loading tickets:', error);
    }
}

function openWhatsApp() {
    const phoneNumber = '91XXXXXXXXXX';
    const message = `Hello, I'm guest ${guestId} at your hotel. I need assistance.`;
    window.open(`https://wa.me/${phoneNumber}?text=${encodeURIComponent(message)}`, '_blank');
}

// Service Requests
function requestService(serviceType) {
    const serviceNames = {
        'room-service': 'Room Service',
        'housekeeping': 'Housekeeping',
        'maintenance': 'Maintenance',
        'concierge': 'Concierge',
        'laundry': 'Laundry',
        'spa': 'Spa Booking'
    };

    document.getElementById('serviceType').value = serviceType;
    document.getElementById('serviceName').value = serviceNames[serviceType];
    document.getElementById('serviceModal').classList.add('active');
}

async function submitServiceRequest(event) {
    event.preventDefault();

    const serviceData = {
        hotelId,
        guestId,
        type: document.getElementById('serviceType').value,
        description: document.getElementById('serviceDescription').value,
        priority: document.getElementById('servicePriority').value
    };

    try {
        showLoading(true);
        const response = await fetch('/api/services/request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(serviceData)
        });

        const data = await response.json();
        if (data.success) {
            showToast('Service request submitted!', 'success');
            closeModal('serviceModal');
            document.getElementById('serviceForm').reset();
        }
    } catch (error) {
        showToast('Error submitting request', 'error');
    } finally {
        showLoading(false);
    }
}

// Utility Functions
function showLoading(show) {
    const overlay = document.getElementById('loadingOverlay');
    if (show) {
        overlay.classList.add('active');
    } else {
        overlay.classList.remove('active');
    }
}

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type} show`;

    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

function toggleLanguage() {
    currentLang = currentLang === 'en' ? 'ar' : 'en';
    document.getElementById('currentLang').textContent = currentLang.toUpperCase();
    document.documentElement.lang = currentLang;
    document.documentElement.dir = currentLang === 'ar' ? 'rtl' : 'ltr';

    // Update UI text based on language
    updateLanguage();
}

function updateLanguage() {
    // Implement language translations
    const translations = {
        en: {
            payments: 'Payments',
            aiAssistant: 'AI Assistant',
            support: '24/7 Support',
            services: 'Services'
        },
        ar: {
            payments: 'المدفوعات',
            aiAssistant: 'المساعد الذكي',
            support: 'الدعم 24/7',
            services: 'الخدمات'
        }
    };

    // Update elements with data-i18n attribute
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (translations[currentLang][key]) {
            el.textContent = translations[currentLang][key];
        }
    });
}

function goBack() {
    window.history.back();
}

function downloadQR() {
    const link = document.createElement('a');
    link.download = 'hotel-upi-qr.png';
    link.href = document.getElementById('upiQRCode').src;
    link.click();
}

async function loadHotelSettings() {
    try {
        const response = await fetch(`/api/guest-hub/settings?hotelId=${hotelId}`);
        const data = await response.json();

        if (data.success) {
            // Update UI with hotel settings
            if (data.settings.supportPhone) {
                document.querySelector('.phone-number').textContent = data.settings.supportPhone;
            }
        }
    } catch (error) {
        console.error('Error loading hotel settings:', error);
    }
}

// Close modals on outside click
window.onclick = function(event) {
    if (event.target.classList.contains('modal')) {
        event.target.classList.remove('active');
    }
}
