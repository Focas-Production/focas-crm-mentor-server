const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const SessionSchema = new Schema({
  sessionId: { type: String, required: true, unique: true, index: true },
  userId: { type: String, required: true, ref: 'User' },
  sessionTitle: { type: String, default: 'Untitled Session' },
  createdAt: { type: Date, default: Date.now },
  lastActivityAt: { type: Date, default: Date.now },
  isCompleted: { type: Boolean, default: false }
});

SessionSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('Session', SessionSchema);
