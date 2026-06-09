const express = require('express');
const router = express.Router();
const tenantController = require('../controllers/tenantController');
const { authMiddleware } = require('../middleware/auth');

router.get('/', tenantController.getTenant);
router.post('/', authMiddleware, tenantController.saveTenant);

module.exports = router;