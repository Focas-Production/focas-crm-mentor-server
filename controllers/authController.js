const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { v4: uuidv4 } = require('uuid');
const axios = require("axios");

const PORT = process.env.PORT || 5000;
const client = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `http://localhost:${PORT}/api/auth/google/callback`
);
const JWT_SECRET = process.env.JWT_SECRET;
const OTP_TTL_MINUTES = parseInt(process.env.PHONE_OTP_TTL_MINUTES || "10", 10);

const { sendOtpMessage } = require("../services/whatsappService");

const generateOtp = () => Math.floor(100000 + Math.random() * 900000).toString();
const buildOtpExpiry = () =>
  new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
// Mock login for testing purposes
exports.mockLogin = async (req, res) => {
  const { email, name } = req.validatedData; 

  if (!email || !name) {
    return res.status(400).json({ message: 'Email and name are required' });
  }

  try {
    let user = await User.findOne({ email });

    if (!user) {
      user = new User({
        userId: uuidv4(),
        email,
        name,
        createdAt: new Date(),
      });
      await user.save();
    }

    // Create JWT token
    const token = jwt.sign(
      { userId: user.userId, email: user.email },
      JWT_SECRET,
      { expiresIn: '20d' }
    );

    res.status(200).json({ 
      token, 
      user: { 
        userId: user.userId, 
        name: user.name, 
        email: user.email 
      } 
    });
  } catch (error) {
    res.status(500).json({ message: 'Login failed', error: error.message });
  }
};

// Redirects user to Google for authentication
exports.googleAuthRedirect = (req, res) => {
  try {
      const authorizeUrl = client.generateAuthUrl({
          access_type: 'offline',
          scope: [
              'https://www.googleapis.com/auth/userinfo.profile',
              'https://www.googleapis.com/auth/userinfo.email'
          ],
          prompt: 'consent'
      });
      console.log('Trying google signin')
      res.redirect(authorizeUrl);
  } catch (error) {
      console.error('Error generating auth URL:', error);
      res.status(500).send('Error initiating Google OAuth');
  }
};

// Handles the Google OAuth callback and returns JWT
exports.googleAuthCallback = async (req, res) => {
  const { code } = req.query;

  if (!code) {
      return res.status(400).send('Authorization code not provided');
  }

  try {
      // Exchange authorization code for tokens
      console.log('Trying google signin callback')

      const { tokens } = await client.getToken(code);
      client.setCredentials(tokens);

      // Get user info
      const ticket = await client.verifyIdToken({
          idToken: tokens.id_token,
          audience: process.env.GOOGLE_CLIENT_ID
      });

      const payload = ticket.getPayload();

      // Find or create user in DB
      let user = await User.findOne({ email: payload.email });
      if (!user) {
          user = new User({
              userId: uuidv4(),
              email: payload.email,
              name: payload.name,
              picture: payload.picture,
              password: '', // No password for Google users
              createdAt: new Date(),
          });
          await user.save();
      }

      // Create JWT token
      const token = jwt.sign(
          { userId: user.userId, email: user.email },
          JWT_SECRET,
          { expiresIn: '1d' }
      );

      // You can either:
      // 1. Redirect to frontend with token in query param (e.g., /dashboard?token=...)
      // 2. Respond with JSON (for SPA/mobile apps)
      // Here, we'll send JSON:
      res.status(200).json({
          token,
          user: {
              userId: user.userId,
              name: user.name,
              email: user.email,
              picture: user.picture
          }
      });
  } catch (error) {
      console.error('Error during Google OAuth callback:', error);
      res.status(500).send('Authentication failed');
  }
};

exports.whatsappSignup = async (req, res) => {
  const { name, phoneNumber } = req.validatedData;

  try {
    const existing = await User.findOne({ phoneNumber });
    if (existing) {
      return res.status(409).json({
        message: "Phone number already in use. Please login with OTP.",
      });
    }

    const user = new User({
      userId: uuidv4(),
      name,
      phoneNumber,
      isPhoneVerified: true,
      createdAt: new Date(),
      lastLogin: new Date(),
    });
    await user.save();

    const token = jwt.sign(
      { userId: user.userId, email: user.email },
      JWT_SECRET,
      { expiresIn: "20d" }
    );

    res.status(201).json({
      token,
      user: {
        userId: user.userId,
        name: user.name,
        phoneNumber: user.phoneNumber,
      },
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        message: "Phone number already in use. Please login with OTP.",
      });
    }
    res.status(500).json({ message: "Signup failed", error: error.message });
  }
};

exports.sendPhoneSignupOtp = async (req, res) => {
  const { phoneNumber, name } = req.validatedData;

  try {
    const existing = await User.findOne({ phoneNumber });
    if (existing && existing.isPhoneVerified) {
      return res.status(409).json({
        message: "Phone number already in use. Please login with OTP.",
      });
    }

    const otp = generateOtp();
    const expires = buildOtpExpiry();

    let user = existing;
    if (!user) {
      user = new User({
        userId: uuidv4(),
        name,
        phoneNumber,
        isPhoneVerified: false,
        createdAt: new Date(),
      });
    } else {
      user.name = name;
    }

    user.phoneOtp = otp;
    user.phoneOtpExpires = expires;
    await user.save();

    try {
      await sendOtpMessage(phoneNumber, otp);
    } catch (error) {
      if (!existing) {
        await User.deleteOne({ userId: user.userId });
      }
      throw error;
    }

    res.json({
      success: true,
      message: "OTP sent successfully",
      otpExpiresAt: expires,
    });
  } catch (error) {
    console.error(
      "Error sending signup OTP:",
      error.response ? error.response.data : error.message
    );
    res.status(500).json({ error: "Failed to send OTP." });
  }
};

exports.verifyPhoneSignupOtp = async (req, res) => {
  const { phoneNumber, otp } = req.validatedData;

  try {
    const user = await User.findOne({
      phoneNumber,
      phoneOtp: otp,
      phoneOtpExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res
        .status(400)
        .json({ message: "Invalid OTP or OTP has expired." });
    }

    user.isPhoneVerified = true;
    user.phoneOtp = null;
    user.phoneOtpExpires = null;
    user.lastLogin = new Date();
    await user.save();

    const token = jwt.sign(
      { userId: user.userId, email: user.email },
      JWT_SECRET,
      { expiresIn: "20d" }
    );

    res.status(200).json({
      token,
      user: {
        userId: user.userId,
        name: user.name,
        phoneNumber: user.phoneNumber,
      },
    });
  } catch (error) {
    res.status(500).json({ message: "Verification failed", error: error.message });
  }
};

exports.sendPhoneLoginOtp = async (req, res) => {
  const { phoneNumber } = req.validatedData;

  try {
    const user = await User.findOne({ phoneNumber });
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }
    if (!user.isPhoneVerified) {
      return res
        .status(400)
        .json({ message: "Phone number is not verified. Please sign up." });
    }

    const otp = generateOtp();
    const expires = buildOtpExpiry();

    user.phoneOtp = otp;
    user.phoneOtpExpires = expires;
    await user.save();

    await sendOtpMessage(phoneNumber, otp);

    res.json({
      success: true,
      message: "OTP sent successfully",
      otpExpiresAt: expires,
    });
  } catch (error) {
    console.error(
      "Error sending login OTP:",
      error.response ? error.response.data : error.message
    );
    res.status(500).json({ error: "Failed to send OTP." });
  }
};

exports.verifyPhoneLoginOtp = async (req, res) => {
  const { phoneNumber, otp } = req.validatedData;

  try {
    const user = await User.findOne({
      phoneNumber,
      phoneOtp: otp,
      phoneOtpExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res
        .status(400)
        .json({ message: "Invalid OTP or OTP has expired." });
    }
    if (!user.isPhoneVerified) {
      return res
        .status(400)
        .json({ message: "Phone number is not verified. Please sign up." });
    }

    user.phoneOtp = null;
    user.phoneOtpExpires = null;
    user.lastLogin = new Date();
    await user.save();

    const token = jwt.sign(
      { userId: user.userId, email: user.email },
      JWT_SECRET,
      { expiresIn: "20d" }
    );

    res.status(200).json({
      token,
      user: {
        userId: user.userId,
        name: user.name,
        phoneNumber: user.phoneNumber,
      },
    });
  } catch (error) {
    res.status(500).json({ message: "Login failed", error: error.message });
  }
};