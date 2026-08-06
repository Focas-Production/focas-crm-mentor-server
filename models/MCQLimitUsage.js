const mongoose = require('mongoose');

const mcqLimitUsageSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    
    // DAILY LIMITS
    dailyResetDate: Date,
    generatedToday: { type: Number, default: 0 },
    evaluationsToday: { type: Number, default: 0 },
    
    // MONTHLY LIMITS
    monthlyResetDate: Date,
    generatedThisMonth: { type: Number, default: 0 },
    evaluationsThisMonth: { type: Number, default: 0 },
    
    // Config stored at time of generation
    dailyLimit: Number,
    monthlyLimit: Number,
    evalDailyLimit: Number,
    evalMonthlyLimit: Number,
  },
  { timestamps: true }
);

module.exports = mongoose.model('MCQLimitUsage', mcqLimitUsageSchema);