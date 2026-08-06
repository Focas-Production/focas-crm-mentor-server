const mongoose = require('mongoose');

// Sub-schema for MCQ data with ALL information
const mcqDataSchema = new mongoose.Schema({
  mcqId: String,
  questionNumber: Number,
  question: String,
  options: [String],
  correctAnswer: String,  // ✅ STORED IN DB ONLY
  explanation: String,
  difficulty: String,
  subject: String,
  chapter: String,
  unit: String,
});

const mcqGenerationSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    level: String,
    subject: { type: String, index: true },
    chapter: { type: String, index: true },
    unit: String,
    difficulty: String,
    numGenerated: Number,
    
    // ✅ STORE ALL MCQ DATA INCLUDING ANSWERS
    mcqData: [mcqDataSchema],
    
    mcqIds: [String],
    status: { type: String, enum: ['pending', 'success', 'failed'], default: 'success' },
    generatedAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

mcqGenerationSchema.index({ 'mcqData.mcqId': 1 });
mcqGenerationSchema.index({ userId: 1, generatedAt: -1 });

module.exports = mongoose.model('MCQGeneration', mcqGenerationSchema);