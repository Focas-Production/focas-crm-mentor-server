const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const QueryUsageSchema = new Schema({
  userId: { type: String, required: true, ref: 'User', index: true },
  date: { type: Date, required: true, index: true }, 
  month: { type: String, required: true, index: true }, 
  dailyCount: { type: Number, default: 0 },
  monthlyCount: { type: Number, default: 0 },
  lastReset: { type: Date, default: Date.now }
});

QueryUsageSchema.index({ userId: 1, date: 1 });
QueryUsageSchema.index({ userId: 1, month: 1 });

module.exports = mongoose.model('QueryUsage', QueryUsageSchema);
