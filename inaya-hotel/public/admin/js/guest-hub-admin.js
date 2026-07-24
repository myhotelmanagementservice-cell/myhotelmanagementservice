// Global Variables
let hotelId = 'HOTEL002';
let currentSettings = {};

// Initialize Admin Panel
document.addEventListener('DOMContentLoaded', function() {
    loadAllSettings();
    loadAnalytics();
    initializeCharts();
});

// Tab Switching
function switchAdminTab(tabName) {
    document.querySelectorAll('.admin-tabs .tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(`${tabName}-tab`).classList.add('active');
}

// Load All Settings
async function loadAllSettings() {
    try {
        const response = await fetch(`/api/admin/guest-hub/settings?hotelId=${hotelId}`);
        const data = await response.json();

        if (data.success) {
            currentSettings = data.settings;
            populateSettingsForm(data.settings);
        }
    } catch (error) {
        console.error('Error loading settings:', error);
        showToast('Error loading settings', 'error');
    }
}

// Populate Settings Form
function populateSettingsForm(settings) {
    // Payment Settings
    document.getElementById('upiId').value = settings.upiId || '';
    if (settings.qrCodeUrl) {
        document.getElementById('qrCodePreview').innerHTML = 
            `<img src="${settings.qrCodeUrl}" alt="QR Code" style="max-width: 200px;">`;
    }
    document.getElementById('paymentGateway').value = settings.paymentGateway || 'razorpay';
    document.getElementById('currencies').value = settings.currencies || 'INR, USD, EUR, GBP';
    document.getElementById('taxPercentage').value = settings.taxPercentage || 18;
    document.getElementById('serviceCharge').value = settings.serviceCharge || 10;

    // AI Settings
    document.getElementById('aiEnabled').checked = settings.aiEnabled !== false;
    document.getElementById('aiProvider').value = settings.aiProvider || 'custom';
    document.getElementById('defaultLanguage').value = settings.defaultLanguage || 'en';

    // Support Settings
    document.getElementById('supportPhone').value = settings.supportPhone || '';
    document.getElementById('supportEmail').value = settings.supportEmail || '';
    document.getElementById('whatsappNumber').value = settings.whatsappNumber || '';
    document.getElementById('supportType').value = settings.supportType || '24/7';

    // Load custom responses and FAQs
    loadCustomResponses(settings.customResponses || {});
    loadFAQs(settings.faqs || {});
}

// Handle QR Code Upload
function handleQRUpload(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            document.getElementById('qrCodePreview').innerHTML = 
                `<img src="${e.target.result}" alt="QR Code" style="max-width: 200px;">`;
        };
        reader.readAsDataURL(file);
    }
}

// Custom Responses Management
function loadCustomResponses(responses) {
    const container = document.getElementById('customResponsesContainer');
    container.innerHTML = '';

    Object.entries(responses).forEach(([keyword, value]) => {
        addCustomResponse(keyword, value.en, value.ar);
    });
}

function addCustomResponse(keyword = '', en = '', ar = '') {
    const container = document.getElementById('customResponsesContainer');
    const div = document.createElement('div');
    div.className = 'custom-response-item';
    div.innerHTML = `
        <div class="form-row">
            <input type="text" placeholder="Keyword (e.g., wifi, bill)" value="${keyword}" class="response-keyword">
            <button type="button" class="btn-remove" onclick="this.parentElement.parentElement.remove()">
                <i class="fas fa-trash"></i>
            </button>
        </div>
        <div class="form-row">
            <input type="text" placeholder="English Response" value="${en}" class="response-en">
            <input type="text" placeholder="Arabic Response" value="${ar}" class="response-ar">
        </div>
    `;
    container.appendChild(div);
}

// FAQ Management
function loadFAQs(faqs) {
    const container = document.getElementById('faqContainer');
    container.innerHTML = '';

    Object.entries(faqs).forEach(([question, answer]) => {
        addFAQ(question, answer.en, answer.ar);
    });
}

function addFAQ(question = '', en = '', ar = '') {
    const container = document.getElementById('faqContainer');
    const div = document.createElement('div');
    div.className = 'faq-item';
    div.innerHTML = `
        <div class="form-group">
            <label>Question</label>
            <input type="text" placeholder="Enter question" value="${question}" class="faq-question">
        </div>
        <div class="form-row">
            <div class="form-group">
                <label>Answer (English)</label>
                <textarea placeholder="Enter answer in English" class="faq-answer-en">${en}</textarea>
            </div>
            <div class="form-group">
                <label>Answer (Arabic)</label>
                <textarea placeholder="Enter answer in Arabic" class="faq-answer-ar">${ar}</textarea>
            </div>
        </div>
        <button type="button" class="btn-remove" onclick="this.parentElement.remove()">
            <i class="fas fa-trash"></i> Remove
        </button>
    `;
    container.appendChild(div);
}

// Save All Settings
async function saveAllSettings() {
    try {
        showLoading(true);

        const settings = {
            // Payment Settings
            upiId: document.getElementById('upiId').value,
            qrCodeUrl: await uploadQRCode(),
            paymentGateway: document.getElementById('paymentGateway').value,
            currencies: document.getElementById('currencies').value,
            taxPercentage: parseFloat(document.getElementById('taxPercentage').value),
            serviceCharge: parseFloat(document.getElementById('serviceCharge').value),

            // AI Settings
            aiEnabled: document.getElementById('aiEnabled').checked,
            aiProvider: document.getElementById('aiProvider').value,
            defaultLanguage: document.getElementById('defaultLanguage').value,
            customResponses: collectCustomResponses(),
            faqs: collectFAQs(),

            // Support Settings
            supportPhone: document.getElementById('supportPhone').value,
            supportEmail: document.getElementById('supportEmail').value,
            whatsappNumber: document.getElementById('whatsappNumber').value,
            supportType: document.getElementById('supportType').value
        };

        const response = await fetch('/api/admin/guest-hub/settings/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                hotelId,
                settings
            })
        });

        const data = await response.json();

        if (data.success) {
            showToast('Settings saved successfully!', 'success');
        } else {
            showToast('Error saving settings', 'error');
        }
    } catch (error) {
        console.error('Error saving settings:', error);
        showToast('Error saving settings', 'error');
    } finally {
        showLoading(false);
    }
}

// Collect Custom Responses
function collectCustomResponses() {
    const responses = {};
    document.querySelectorAll('.custom-response-item').forEach(item => {
        const keyword = item.querySelector('.response-keyword').value.trim();
        const en = item.querySelector('.response-en').value.trim();
        const ar = item.querySelector('.response-ar').value.trim();

        if (keyword && en) {
            responses[keyword] = { en, ar };
        }
    });
    return responses;
}

// Collect FAQs
function collectFAQs() {
    const faqs = {};
    document.querySelectorAll('.faq-item').forEach(item => {
        const question = item.querySelector('.faq-question').value.trim();
        const en = item.querySelector('.faq-answer-en').value.trim();
        const ar = item.querySelector('.faq-answer-ar').value.trim();

        if (question && en) {
            faqs[question] = { en, ar };
        }
    });
    return faqs;
}

// Upload QR Code
async function uploadQRCode() {
    const fileInput = document.getElementById('qrCodeUpload');
    if (fileInput.files.length === 0) {
        return currentSettings.qrCodeUrl || '';
    }

    const formData = new FormData();
    formData.append('qrCode', fileInput.files[0]);
    formData.append('hotelId', hotelId);

    const response = await fetch('/api/admin/upload/qr-code', {
        method: 'POST',
        body: formData
    });

    const data = await response.json();
    return data.url || '';
}

// Load Analytics
async function loadAnalytics() {
    try {
        const response = await fetch(`/api/admin/analytics/guest-hub?hotelId=${hotelId}`);
        const data = await response.json();

        if (data.success) {
            document.getElementById('totalPayments').textContent = `₹${data.totalPayments}`;
            document.getElementById('activeTickets').textContent = data.activeTickets;
            document.getElementById('aiConversations').textContent = data.aiConversations;
            document.getElementById('serviceRequests').textContent = data.serviceRequests;

            updateCharts(data);
        }
    } catch (error) {
        console.error('Error loading analytics:', error);
    }
}

// Initialize Charts
let paymentChart, ticketChart;

function initializeCharts() {
    // Payment Chart
    const paymentCtx = document.getElementById('paymentChart').getContext('2d');
    paymentChart = new Chart(paymentCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Payments',
                data: [],
                borderColor: '#2563eb',
                backgroundColor: 'rgba(37, 99, 235, 0.1)',
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true
        }
    });

    // Ticket Chart
    const ticketCtx = document.getElementById('ticketChart').getContext('2d');
    ticketChart = new Chart(ticketCtx, {
        type: 'doughnut',
        data: {
            labels: ['Open', 'In Progress', 'Resolved'],
            datasets: [{
                data: [0, 0, 0],
                backgroundColor: ['#ef4444', '#f59e0b', '#10b981']
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true
        }
    });
}

// Update Charts
function updateCharts(data) {
    if (paymentChart) {
        paymentChart.data.labels = data.paymentDates || [];
        paymentChart.data.datasets[0].data = data.paymentAmounts || [];
        paymentChart.update();
    }

    if (ticketChart) {
        ticketChart.data.datasets[0].data = [
            data.openTickets || 0,
            data.inProgressTickets || 0,
            data.resolvedTickets || 0
        ];
        ticketChart.update();
    }
}

// Export Data
function exportData(type) {
    window.location.href = `/api/admin/export/${type}?hotelId=${hotelId}&format=csv`;
}

// Utility Functions
function showLoading(show) {
    const overlay = document.getElementById('loadingOverlay');
    if (!overlay) {
        const div = document.createElement('div');
        div.id = 'loadingOverlay';
        div.className = 'loading-overlay';
        div.innerHTML = '<div class="spinner"></div><p>Saving...</p>';
        document.body.appendChild(div);
    }

    if (show) {
        document.getElementById('loadingOverlay').style.display = 'flex';
    } else {
        document.getElementById('loadingOverlay').style.display = 'none';
    }
}

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('show');
    }, 100);

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Support Type Change Handler
document.getElementById('supportType')?.addEventListener('change', function() {
    const scheduledHours = document.getElementById('scheduledHours');
    if (this.value === 'scheduled') {
        scheduledHours.style.display = 'block';
    } else {
        scheduledHours.style.display = 'none';
    }
});
