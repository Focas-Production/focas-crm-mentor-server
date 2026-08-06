const express = require('express');
const router = express.Router();
const questionController = require('../controllers/questionController');
const { protect, requireAdmin } = require('../middleware/authMiddleware');
const { checkQueryLimits } = require('../middleware/queryLimiter');
const { checkProfileRequired } = require('../middleware/profileMiddleware');
const { questionSchema } = require("../zodSchemas/questionSchema");
const validate = require("../middleware/validate"); 


router.post('/', protect, checkProfileRequired, validate(questionSchema), checkQueryLimits, questionController.createQuestion);
router.get('/session/:sessionId', protect, questionController.getQuestionsBySession);
router.get('/:questionId', protect, questionController.getQuestionById);
router.put('/:questionId', protect, questionController.updateQuestion);
router.delete('/:questionId', protect, questionController.deleteQuestion);

// ===== ADMIN ROUTES =====
router.get('/admin/session/:sessionId', protect, requireAdmin, questionController.getSessionQuestionsAdmin);

module.exports = router;
