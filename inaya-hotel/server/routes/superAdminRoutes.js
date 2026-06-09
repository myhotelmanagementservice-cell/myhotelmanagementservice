const express = require('express');
const router = express.Router();
const superAdminController = require('../controllers/superAdminController');
const { superAdminMiddleware } = require('../middleware/auth');

// All routes require super admin authentication
router.use(superAdminMiddleware);

// Hotel management
router.post('/tenants/register', superAdminController.registerHotel);
router.get('/tenants', superAdminController.listHotels);
router.put('/tenants/:hotelId', superAdminController.updateHotel);
router.delete('/tenants/:hotelId', superAdminController.deleteHotel);
router.get('/countries', superAdminController.getCountries);

// Admin management
router.post('/admins/register', superAdminController.registerAdmin);

// Platform stats & transactions
router.get('/stats', superAdminController.getStats);
router.get('/transactions', superAdminController.getTransactions);

module.exports = router;