const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { protect, requireAdmin } = require('../middleware/authMiddleware');

// Admin login route (no authentication required)
router.post('/login', adminController.adminLogin);

// All other routes require admin authentication
router.get('/users', protect, requireAdmin, adminController.getAllUsers);
router.get('/users/exam-range', protect, requireAdmin, adminController.getUsersByExamDateRange);
router.get('/comprehensive-data', protect, requireAdmin, adminController.getComprehensiveAdminData);

module.exports = router;