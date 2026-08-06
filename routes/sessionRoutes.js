const express = require('express');
const router = express.Router();
const sessionController = require('../controllers/sessionController');
const { protect, requireAdmin } = require('../middleware/authMiddleware');
const { sessionCreateSchema, sessionUpdateSchema } = require("../zodSchemas/sessionSchema");
const validate = require("../middleware/validate");

// ===== TEST ROUTE =====
router.get('/test', (req, res) => {
  res.json({ message: 'Session routes are working' });
});

// ===== ADMIN ROUTES (must come before generic routes) =====
router.get('/admin/all', protect, requireAdmin, sessionController.getAllSessionsAdmin);
router.get('/admin/user/:userId', protect, requireAdmin, sessionController.getUserSessionsAdmin);
router.get('/admin/count/:userId', protect, requireAdmin, sessionController.getUserSessionCountAdmin);

// ===== REGULAR ROUTES =====
router.post('/', protect, validate(sessionCreateSchema), sessionController.createSession);
router.get('/', protect, sessionController.getUserSessions);

// ===== SESSION-SPECIFIC ROUTES (must come after admin routes) =====
router.get('/:sessionId', protect, sessionController.getSessionById);
router.put('/:sessionId', protect, validate(sessionUpdateSchema), sessionController.updateSession);
router.delete('/:sessionId', protect, sessionController.deleteSession);

module.exports = router;
