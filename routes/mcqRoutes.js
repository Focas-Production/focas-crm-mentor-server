const express = require('express');
const generateController = require('../controllers/mcqGenerateController');
const evaluationController = require('../controllers/mcqEvaluationController');
const dashboardController = require('../controllers/dashboardController');
const resultsController = require('../controllers/resultsController');
const { protect } = require('../middleware/authMiddleware');


const router = express.Router();

// ✅ ALL ROUTES PROTECTED WITH AUTH


// GENERATION
router.post('/generate', protect, generateController.generateMCQ);

// EVALUATION (Only once per MCQ)
router.post('/submit', protect, evaluationController.submitAnswer);

// DASHBOARD
router.get('/dashboard', protect, dashboardController.getDashboard);
router.get('/progress', protect,dashboardController.getProgressByFilter);

// RESULTS
router.get('/results', protect, resultsController.getUserResults);

//New Last Attempted MCQ Routes
router.get('/last-attempted', protect, resultsController.getLastAttempted);
router.get('/last-attempted-filter', protect, resultsController.getLastAttemptedByFilter);
router.get('/last-attempted-list', protect, resultsController.getLastAttemptedList);

module.exports = router;