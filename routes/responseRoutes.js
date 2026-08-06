const express = require('express');
const router = express.Router();
const responseController = require('../controllers/responseController');
const { protect, requireAdmin } = require('../middleware/authMiddleware');
const { responseSchema } = require("../zodSchemas/responseSchema");
const validate = require("../middleware/validate");

router.post('/', protect,validate(responseSchema), responseController.createResponse);
router.get('/session/:sessionId', protect, responseController.getResponsesBySession);
router.get('/question/:questionId', protect, responseController.getResponsesByQuestion);
router.get('/:responseId', protect, responseController.getResponseById);
router.delete('/:responseId', protect, responseController.deleteResponse);

// ===== ADMIN ROUTES =====
router.get('/admin/session/:sessionId', protect, requireAdmin, responseController.getSessionResponsesAdmin);

module.exports = router;
