const express = require('express');
const router = express.Router();
const profileController = require('../controllers/profileController');
const { protect } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const { 
  phoneNumberSchema, 
  personalDetailsSchema, 
  examDateSchema ,
  otpSchema
} = require('../zodSchemas/profileSchema');

router.post('/send-otp', protect, validate(phoneNumberSchema), profileController.sendPhoneOtp);

// Step 2: Verify the OTP and update the phone number
router.post('/verify-otp', protect, validate(otpSchema), profileController.verifyPhoneOtp);

// Get onboarding status and trial information
router.get('/onboarding-status', protect, profileController.checkOnboardingStatus);

// Profile completion steps
router.put('/phone', protect, validate(phoneNumberSchema), profileController.updatePhoneNumber);
router.put('/personal-details', protect, validate(personalDetailsSchema), profileController.updatePersonalDetails);
router.put('/exam-date', protect, validate(examDateSchema), profileController.updateExamDate);

// Skip profile setup (one-time only)
router.post('/skip', protect, profileController.skipProfileSetup);

// Clear session skip (called on app restart)
router.post('/clear-session-skip', protect, profileController.clearSessionSkip);

// Get complete profile
router.get('/profile', protect, profileController.getUserProfile);

// Update exam date reminder (45-day cycle)
router.put('/exam-date-reminder', protect, validate(examDateSchema), profileController.updateExamDateReminder);

module.exports = router;
