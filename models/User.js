const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const UserSchema = new Schema({
  userId: { type: String,  unique: true, index: true },
  email: { type: String, lowercase: true, trim: true },
  name: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  lastLogin: { type: Date },
  
  // Profile fields
  phoneNumber: { type: String, default: undefined },
  city: { type: String, default: null },
  caLevel: { 
    type: String, 
    enum: ['CA Foundation', 'CA Intermediate', 'CA Final'], 
    default: null 
  },
  examDate: { type: Date, default: null },

  isAdmin: { type: Boolean, default: false },
    
  // Onboarding status tracking
  profileCompleted: { type: Boolean, default: false },
  profileSkipped: { type: Boolean, default: false },
  sessionSkipActive: { type: Boolean, default: false }, 
  lastExamDateUpdate: { type: Date, default: null },
  lastPhoneUpdate: { type: Date, default: null },
  freeTrialUsed: { type: Boolean, default: false },
  
  // --- Fields for OTP Verification ---
  isPhoneVerified: { type: Boolean, default: false },
  phoneOtp: { type: String, default: null },
  phoneOtpExpires: { type: Date, default: null },
  
  // CA Exam attempt tracking
  attemptGiven: {
    type: String,
    enum: ['Sep -2026', 'Jan -2027'],
    default: null
  },

  // Trial and reminder tracking
  trialStartTime: { type: Date, default: Date.now },
  nextExamDateReminder: { type: Date, default: null },
 /*  subscriptionType: {  // ← ADD THIS
    type: String,
    enum: ['free', 'premium'],
    default: 'free'
  }, */
});

// Enforce uniqueness only when a real phoneNumber is present.
UserSchema.index(
  { phoneNumber: 1 },
  { unique: true, partialFilterExpression: { phoneNumber: { $type: 'string' } } }
);

// Enforce unique emails only when a real email string is present.
UserSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: 'string' } } }
);

module.exports = mongoose.model('User', UserSchema);
