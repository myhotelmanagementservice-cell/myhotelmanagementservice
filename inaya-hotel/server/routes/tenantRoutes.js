const express = require('express');
const router = express.Router();
const tenantController = require('../controllers/tenantController');
const { authMiddleware } = require('../middleware/auth');

// ✅ LOGIN ROUTES (No auth required)
router.post('/login', tenantController.login);
router.post('/guest/login', tenantController.guestLogin);
router.post('/admin/login', tenantController.adminLogin);

// ✅ PUBLIC ROUTES (No auth required)
router.get('/', tenantController.getTenant);
router.get('/health', (req, res) => res.json({ status: 'OK', timestamp: new Date() }));

// ✅ PROTECTED ROUTES (Auth required)
router.post('/save', authMiddleware, tenantController.saveTenant);
router.put('/update', authMiddleware, tenantController.updateTenant);
router.delete('/delete/:id', authMiddleware, tenantController.deleteTenant);

// ✅ DATA ROUTES (Auth required)
router.get('/rooms', authMiddleware, tenantController.getRooms);
router.post('/rooms', authMiddleware, tenantController.saveRoom);
router.get('/guests', authMiddleware, tenantController.getGuests);
router.get('/food', authMiddleware, tenantController.getFood);
router.get('/inventory', authMiddleware, tenantController.getInventory);
router.get('/requests', authMiddleware, tenantController.getRequests);
router.get('/bookings', authMiddleware, tenantController.getBookings);
router.get('/staff', authMiddleware, tenantController.getStaff);
router.get('/logs', authMiddleware, tenantController.getLogs);
router.get('/policies', authMiddleware, tenantController.getPolicies);
router.get('/announcements', authMiddleware, tenantController.getAnnouncements);
router.get('/departments', authMiddleware, tenantController.getDepartments);
router.get('/config', authMiddleware, tenantController.getConfig);

module.exports = router;