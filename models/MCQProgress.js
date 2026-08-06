/*
FILE: src/models/MCQProgress.js
Tracks progress by subject/chapter/unit
*/

const mongoose = require('mongoose');

const mcqProgressSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    level: String,
    subject: { type: String, index: true },
    chapter: { type: String, index: true },
    unit: String,
    
    totalAttempted: { type: Number, default: 0 },
    totalCorrect: { type: Number, default: 0 },
    avgScore: { type: Number, default: 0 },
    
    firstAttempted: Date,
    lastAttempted: Date,
    lastScore: Number,
  },
  { timestamps: true }
);

module.exports = mongoose.model('MCQProgress', mcqProgressSchema);