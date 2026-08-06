const User = require("../models/User");
const { sendOtpMessage } = require("../services/whatsappService");

exports.sendPhoneOtp = async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    if (!phoneNumber) {
      return res.status(400).json({ message: "Phone number is required." });
    }

    // 1. Find the user in the database to get their name
    const user = await User.findOne({ userId: req.user.userId });
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    // 2. Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes expiry

    // 3. Save OTP to database (but don't update phone number yet)
    await User.findOneAndUpdate(
      { userId: req.user.userId },
      {
        phoneOtp: otp,
        phoneOtpExpires: expires,
        isPhoneVerified: false,
      },
      { new: true }
    );

    // 4. Send OTP via our WhatsApp Cloud API
    await sendOtpMessage(phoneNumber, otp);

    res.json({
      success: true,
      message: "OTP sent successfully to " + phoneNumber,
    });
  } catch (error) {
    console.error(
      "Error sending OTP:",
      error.response ? error.response.data : error.message
    );
    res.status(500).json({ error: "Failed to send OTP." });
  }
};

exports.verifyPhoneOtp = async (req, res) => {
  try {
    const { phoneNumber, otp } = req.body;

    console.log("--- Verifying OTP for user... ---");

    // Find user with matching OTP and check expiry
    const user = await User.findOne({
      userId: req.user.userId,
      phoneOtp: otp,
      phoneOtpExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res
        .status(400)
        .json({ message: "Invalid OTP or OTP has expired." });
    }

    // Mark phone as verified but don't save phone number yet
    user.isPhoneVerified = true;
    user.phoneOtp = null;
    user.phoneOtpExpires = null;

    await user.save();

    res.json({ success: true, message: "OTP verified successfully." });
  } catch (error) {
    console.error("Error verifying OTP:", error.message);
    res.status(500).json({ error: "An error occurred during verification." });
  }
};

exports.checkOnboardingStatus = async (req, res) => {
  try {
    const user = await User.findOne({ userId: req.user.userId });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const now = new Date();
    const thirtyMinutesAfterCreation = new Date(
      user.trialStartTime.getTime() + 30 * 60 * 1000
    ); // 30 minutes for production
    // const thirtyMinutesAfterCreation = new Date(user.trialStartTime.getTime() + 1 * 60 * 1000); // 1 minute for testing
    const isTrialActive =
      now < thirtyMinutesAfterCreation && !user.freeTrialUsed;

    // Check if exam date reminder is due
    const needsExamDateUpdate =
      user.lastExamDateUpdate &&
      now >
        new Date(user.lastExamDateUpdate.getTime() + 45 * 24 * 60 * 60 * 1000); // 45 days for production
    // const needsExamDateUpdate = user.lastExamDateUpdate &&
    //   now > new Date(user.lastExamDateUpdate.getTime() + 5 * 60 * 1000); // 5 minutes for testing

    // Check phone edit cooldown (1 week)
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const canEditPhone =
      !user.lastPhoneUpdate || user.lastPhoneUpdate < oneWeekAgo;
    const phoneEditCooldownRemaining = user.lastPhoneUpdate
      ? Math.max(
          0,
          new Date(user.lastPhoneUpdate.getTime() + 7 * 24 * 60 * 60 * 1000) -
            now
        )
      : 0;

    res.json({
      needsOnboarding:
        !user.profileCompleted && !isTrialActive && !user.sessionSkipActive,
      isTrialActive,
      profileCompleted: user.profileCompleted,
      profileSkipped: user.profileSkipped,
      sessionSkipActive: user.sessionSkipActive,
      needsExamDateUpdate,
      canSkip: !user.profileSkipped && !user.profileCompleted,
      trialTimeRemaining: isTrialActive
        ? Math.max(0, thirtyMinutesAfterCreation - now)
        : 0,
      canEditPhone,
      phoneEditCooldownRemaining,
      profile: {
        phoneNumber: user.phoneNumber,
        city: user.city,
        caLevel: user.caLevel,
        examDate: user.examDate,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Update phone number (Step 1)
exports.updatePhoneNumber = async (req, res) => {
  try {
    const { phoneNumber } = req.validatedData;

    const checkUser = await User.findOne({ userId: req.user.userId });
    if (!checkUser.isPhoneVerified) {
      return res
        .status(400)
        .json({ message: "Phone number must be verified with OTP first." });
    }
    const existingPhoneUser = await User.findOne({
      phoneNumber,
      userId: { $ne: req.user.userId },
    });
    if (existingPhoneUser) {
      return res.status(409).json({
        message: "Phone number already in use. Please use a different number.",
      });
    }

    const user = await User.findOneAndUpdate(
      { userId: req.user.userId },
      {
        phoneNumber,
        lastPhoneUpdate: new Date(),
      },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({ success: true, phoneNumber: user.phoneNumber });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Update personal details (Step 2)
exports.updatePersonalDetails = async (req, res) => {
  try {
    const { city, caLevel } = req.validatedData;

    const user = await User.findOneAndUpdate(
      { userId: req.user.userId },
      { city, caLevel },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({ success: true, city: user.city, caLevel: user.caLevel });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Update exam date (Step 3) - Completes profile
exports.updateExamDate = async (req, res) => {
  try {
    const { examDate } = req.validatedData;
    const now = new Date();

    const user = await User.findOneAndUpdate(
      { userId: req.user.userId },
      {
        examDate: new Date(examDate),
        lastExamDateUpdate: now,
        profileCompleted: true,
        profileSkipped: false,
        freeTrialUsed: true,
        nextExamDateReminder: new Date(
          now.getTime() + 45 * 24 * 60 * 60 * 1000
        ), // 45 days for production
        // nextExamDateReminder: new Date(now.getTime() + 5 * 60 * 1000) // 5 minutes for testing
      },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      success: true,
      examDate: user.examDate,
      profileCompleted: true,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Skip profile setup (one-time only)
exports.skipProfileSetup = async (req, res) => {
  try {
    const user = await User.findOne({ userId: req.user.userId });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check if already skipped
    if (user.profileSkipped) {
      return res.status(400).json({
        error: "Skip already used",
        message:
          "You have already used your one-time skip option. Please complete your profile to continue.",
      });
    }

    // Check if profile is already completed
    if (user.profileCompleted) {
      return res.status(400).json({
        error: "Profile already completed",
        message: "Your profile is already completed.",
      });
    }

    // Mark profile as skipped permanently and activate session skip
    await User.findOneAndUpdate(
      { userId: req.user.userId },
      {
        profileSkipped: true,
        sessionSkipActive: true,
        // Note: Don't set freeTrialUsed = true here to keep trial active for current session
      }
    );

    res.json({
      success: true,
      message:
        "Profile setup skipped successfully. This was your one-time skip option.",
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get complete profile
exports.getUserProfile = async (req, res) => {
  try {
    const user = await User.findOne({ userId: req.user.userId });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      profile: {
        phoneNumber: user.phoneNumber,
        city: user.city,
        caLevel: user.caLevel,
        examDate: user.examDate,
      },
      profileCompleted: user.profileCompleted,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Clear session skip (called when app restarts)
exports.clearSessionSkip = async (req, res) => {
  try {
    await User.findOneAndUpdate(
      { userId: req.user.userId },
      { sessionSkipActive: false }
    );

    res.json({ success: true, message: "Session skip cleared" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Update exam date reminder (for 45-day cycle)
exports.updateExamDateReminder = async (req, res) => {
  try {
    const { examDate } = req.validatedData;
    const now = new Date();

    const user = await User.findOneAndUpdate(
      { userId: req.user.userId },
      {
        examDate: new Date(examDate),
        lastExamDateUpdate: now,
        nextExamDateReminder: new Date(
          now.getTime() + 45 * 24 * 60 * 60 * 1000
        ), // 45 days for production
        // nextExamDateReminder: new Date(now.getTime() + 5 * 60 * 1000) // 5 minutes for testing
      },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({ success: true, examDate: user.examDate });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};