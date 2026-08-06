const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const validate = require('../middleware/validate');
const {  mockLoginSchema,whatsappSignupSchema, phoneSignupOtpSchema,phoneLoginOtpSchema,phoneVerifyOtpSchema,} = require('../zodSchemas/userSchema');

router.post('/mock-login',validate(mockLoginSchema), authController.mockLogin); // For testing purposes
// Google OAuth2 routes
router.get('/google', authController.googleAuthRedirect);
router.get('/google/callback', authController.googleAuthCallback);
// WhatsApp signup (name + phone number)
router.post('/whatsapp/signup',validate(whatsappSignupSchema),authController.whatsappSignup);
// Phone signup with OTP
router.post('/phone/signup/send-otp',validate(phoneSignupOtpSchema),authController.sendPhoneSignupOtp);
router.post('/phone/signup/verify-otp',validate(phoneVerifyOtpSchema),authController.verifyPhoneSignupOtp);
// Phone login with OTP
router.post('/phone/login/send-otp',validate(phoneLoginOtpSchema),authController.sendPhoneLoginOtp);
router.post('/phone/login/verify-otp',validate(phoneVerifyOtpSchema),authController.verifyPhoneLoginOtp);

module.exports = router;