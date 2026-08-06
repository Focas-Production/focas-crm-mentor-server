const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const ResponseSchema = new Schema({
  responseId: { type: String, required: true, unique: true, index: true },
  sessionId: { type: String, required: true, ref: 'Session' },
  questionId: { type: String, required: true, ref: 'Question' },
  userId: { type: String, required: true, ref: 'User' },
  responseType: { type: String, enum: ['text', 'audio'], required: true },
  content: { type: String, required: true },
  isStepByStep: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

ResponseSchema.index({ sessionId: 1, userId: 1 });
ResponseSchema.index({ questionId: 1, userId: 1 });

module.exports = mongoose.model('Response', ResponseSchema);
