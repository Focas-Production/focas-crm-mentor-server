const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const QuestionSchema = new Schema({
  questionId: { type: String, required: true, unique: true, index: true },
  sessionId: { type: String, required: true, ref: 'Session' },
  userId: { type: String, required: true, ref: 'User' },
  questionType: { type: String, enum: ['numerical', 'theoretical'], required: true },
  inputType: { type: String, enum: ['text', 'voice', 'image', 'pdf'], required: true },
  content: { type: String, required: false, default: '' },
  fileId: { type: String, ref: 'File', default: null },
  topic: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

QuestionSchema.index({ sessionId: 1, userId: 1 });

module.exports = mongoose.model('Question', QuestionSchema);
