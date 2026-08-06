// models/Subscription.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const SubscriptionSchema = new Schema({
  userId: { type: String, required: true, ref: 'User', index: true },
  plan: { 
    type: String, 
    enum: ['free', 'pro'], 
    default: 'free' 
  },
  status: { 
    type: String, 
    enum: ['active', 'expired', 'cancelled'], 
    default: 'active' 
  },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  
  // Razorpay payment details
  razorpayOrderId: { type: String, default: null },
  razorpayPaymentId: { type: String, default: null },
  razorpaySignature: { type: String, default: null },
  
  // Payment details
  amount: { type: Number, required: true },
  currency: { type: String, default: 'INR' },
  
  // Query limits
  monthlyQueryLimit: { type: Number, required: true },
  queriesUsed: { type: Number, default: 0 },
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Index for finding active subscriptions
SubscriptionSchema.index({ userId: 1, status: 1, endDate: 1 });

// Method to check if subscription is valid
SubscriptionSchema.methods.isValid = function() {
  return this.status === 'active' && this.endDate > new Date();
};

// Method to check if user has queries remaining
SubscriptionSchema.methods.hasQueriesRemaining = function() {
  return this.queriesUsed < this.monthlyQueryLimit;
};

module.exports = mongoose.model('Subscription', SubscriptionSchema);