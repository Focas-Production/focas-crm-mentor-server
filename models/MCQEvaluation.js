/*
FILE: src/models/MCQEvaluation.js
Stores all evaluations (answer submissions)
Each MCQ can only be evaluated ONCE per user
*/

const mongoose = require('mongoose');

const mcqEvaluationSchema = new mongoose.Schema(
  {
    // ✅ ADD THIS NEW FIELD
    evaluationId: {
      type: String,
      required: true,
      unique: true,
      sparse: true,
      index: true,
    },
    
    userId: { type: String, required: true, index: true },
    mcqId: { type: String, required: true },
    level: String,
    subject: { type: String, index: true },
    chapter: { type: String, index: true },
    unit: String,
    questionNumber: Number,
    userAnswer: String,
    correctAnswer: String,
    isCorrect: Boolean,
    score: Number,
    timeSpent: Number,
    submittedAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

// ✅ UNIQUE INDEX: One evaluation per MCQ per user
mcqEvaluationSchema.index({ userId: 1, mcqId: 1 }, { unique: true });

module.exports = mongoose.model('MCQEvaluation', mcqEvaluationSchema)