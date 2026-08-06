// routes/payment.js
const express = require('express');
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");

const paymentController = require('../controllers/paymentController');

// Create Razorpay order
router.post('/create-order', protect, paymentController.createOrder);

// Verify payment and activate subscription
router.post('/verify-payment', protect, paymentController.verifyPayment);

// Get current subscription status
router.get('/subscription-status', protect, paymentController.getSubscriptionStatus);

// Get payment history
router.get('/payment-history', protect, paymentController.getPaymentHistory);

module.exports = router;