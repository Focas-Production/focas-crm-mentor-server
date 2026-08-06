const axios = require('axios');
const MCQGeneration = require('../models/MCQGeneration');
const MCQEvaluation = require('../models/MCQEvaluation');
const MCQProgress = require('../models/MCQProgress');
const { v4: uuidv4 } = require('uuid');
const { NotFoundError, DuplicateSubmissionError } = require('../utils/errors');

const generateMCQsFromPython = async (level, subject, chapter, unit, difficulty, count) => {
  try {
    const response = await axios.post(
      process.env.PYTHON_MCQ_API_URL || 'http://localhost:5555/api/mcq/generate',
      {
        level,
        subject,
        chapter_name: chapter,
        unit_name: unit,
        difficulty,
        num_questions: count,
      },
      { timeout: 300000 }
    );
    return response.data;
  } catch (error) {
    console.log('Python API Error:', error.message);
    
    throw new Error(`Python API Error: ${error.message}`);
  }
};

/**
 * ✅ SAVE MCQ DATA - COMPLETE WITH ANSWERS IN DB
 * Data stored: question, options, correct answer, explanation
 */
const saveMCQGeneration = async (userId, data, mcqIds, pythonMcqs) => {
  const generation = new MCQGeneration({
    userId,
    level: data.level,
    subject: data.subject,
    chapter: data.chapter,
    unit: data.unit,
    difficulty: data.difficulty,
    numGenerated: mcqIds.length,
    
    // ✅ STORE COMPLETE DATA INCLUDING CORRECT ANSWERS
    mcqData: pythonMcqs.map((mcq, idx) => ({
      mcqId: mcqIds[idx],
      questionNumber: mcq.question_number || idx + 1,
      question: mcq.question,
      options: mcq.options,
      correctAnswer: mcq.correct_answer,  // ✅ STORED HERE IN DB
      explanation: mcq.explanation,
      difficulty: mcq.difficulty,
      subject: data.subject,
      chapter: data.chapter,
      unit: data.unit,
    })),
    
    mcqIds,
  });
  
  return await generation.save();
};

/**
 * ✅ GET MCQ DATA FROM DB (Used during evaluation)
 * Returns correct answer for validation
 */
const getMCQData = async (mcqId) => {
  const generation = await MCQGeneration.findOne(
    { 'mcqData.mcqId': mcqId },
    { 'mcqData.$': 1 }
  );

  if (!generation || !generation.mcqData || generation.mcqData.length === 0) {
    throw new NotFoundError('MCQ not found');
  }

  return generation.mcqData[0];
};

/**
 * ✅ SUBMIT MCQ ANSWER
 * Gets correct answer from DB and validates
 */
const submitMCQAnswer = async (userId, mcqId, userAnswer, data) => {
  try {
    // ✅ CHECK IF ALREADY SUBMITTED
    const existing = await MCQEvaluation.findOne({ userId, mcqId });
    if (existing) {
      throw new DuplicateSubmissionError('This MCQ has already been submitted');
    }

    // ✅ GET MCQ DATA FROM DB
    const mcqData = await getMCQData(mcqId);

    // ✅ VALIDATE ANSWER
    const isCorrect = userAnswer.toUpperCase().trim() === 
                     mcqData.correctAnswer.toUpperCase().trim();

    // ✅ GENERATE UNIQUE ID - THIS IS THE KEY FIX
    const evaluationId = uuidv4();

    // ✅ CREATE EVALUATION WITH evaluationId
    const evaluation = new MCQEvaluation({
      evaluationId,  // ← ADD THIS (newly generated UUID)
      userId,
      mcqId,
      level: mcqData.level || data.level,
      subject: mcqData.subject,
      chapter: mcqData.chapter,
      unit: mcqData.unit,
      questionNumber: mcqData.questionNumber,
      userAnswer,
      correctAnswer: mcqData.correctAnswer,
      isCorrect,
      score: isCorrect ? 100 : 0,
      timeSpent: data.timeSpent,
    });

    // ✅ SAVE TO DATABASE
    await evaluation.save();

    // ✅ UPDATE PROGRESS
    await updateProgress(userId, mcqData, isCorrect);

    // ✅ RETURN RESPONSE
    return {
      evaluation,
      explanation: mcqData.explanation,
      question: mcqData.question,
    };
  } catch (error) {
    console.error('submitMCQAnswer Error:', error);
    throw error;
  }
};

const updateProgress = async (userId, mcqData, isCorrect) => {
  const progress = await MCQProgress.findOne({
    userId,
    subject: mcqData.subject,
    chapter: mcqData.chapter,
    unit: mcqData.unit,
  });

  if (!progress) {
    const newProgress = new MCQProgress({
      userId,
      level: mcqData.level,
      subject: mcqData.subject,
      chapter: mcqData.chapter,
      unit: mcqData.unit,
      totalAttempted: 1,
      totalCorrect: isCorrect ? 1 : 0,
      avgScore: isCorrect ? 100 : 0,
      firstAttempted: new Date(),
      lastAttempted: new Date(),
      lastScore: isCorrect ? 100 : 0,
    });
    await newProgress.save();
  } else {
    const newTotalCorrect = progress.totalCorrect + (isCorrect ? 1 : 0);
    const newTotalAttempted = progress.totalAttempted + 1;
    const avgScore = Math.round((newTotalCorrect / newTotalAttempted) * 100);

    await MCQProgress.findByIdAndUpdate(progress._id, {
      $set: {
        totalAttempted: newTotalAttempted,
        totalCorrect: newTotalCorrect,
        avgScore,
        lastAttempted: new Date(),
        lastScore: isCorrect ? 100 : 0,
      },
    });
  }
};

const getUserResults = async (userId, filters, limit, page) => {
  const query = { userId };
  if (filters.subject) query.subject = filters.subject;
  if (filters.chapter) query.chapter = filters.chapter;
  if (filters.unit) query.unit = filters.unit;

  const skip = (page - 1) * limit;

  const results = await MCQEvaluation.find(query)
    .sort({ submittedAt: -1 })
    .limit(limit)
    .skip(skip)
    .lean();

  const total = await MCQEvaluation.countDocuments(query);

  return { results, total, pages: Math.ceil(total / limit) };
};


/**
 * ========================================================
 * BACKEND - GET LAST ATTEMPTED MCQ WITH ANSWER & RESULT
 * ========================================================
 */

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FILE 1: src/services/mcqService.js (ADD NEW FUNCTION)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Add this function to your existing mcqService.js

/**
 * Get last attempted MCQ with answer and result
 */
const getLastAttemptedMCQ = async (userId) => {
  try {
    // ✅ GET LATEST EVALUATION (Most recent submission)
    const lastEvaluation = await MCQEvaluation.findOne({ userId })
      .sort({ submittedAt: -1 })
      .lean();

    if (!lastEvaluation) {
      return null; // No MCQ attempted yet
    }

    // ✅ GET MCQ DATA (Question, options, explanation)
    const mcqGeneration = await MCQGeneration.findOne(
      { 'mcqData.mcqId': lastEvaluation.mcqId },
      { 'mcqData.$': 1 }
    ).lean();

    if (!mcqGeneration || !mcqGeneration.mcqData || mcqGeneration.mcqData.length === 0) {
      return null;
    }

    const mcqData = mcqGeneration.mcqData[0];

    // ✅ COMBINE DATA
    return {
      mcqId: lastEvaluation.mcqId,
      questionNumber: lastEvaluation.questionNumber,
      question: mcqData.question,
      options: mcqData.options,
      difficulty: mcqData.difficulty,
      subject: lastEvaluation.subject,
      chapter: lastEvaluation.chapter,
      unit: lastEvaluation.unit || 'N/A',
      
      // User's Answer & Result
      userAnswer: lastEvaluation.userAnswer,
      correctAnswer: lastEvaluation.correctAnswer,
      isCorrect: lastEvaluation.isCorrect,
      score: lastEvaluation.score,
      timeSpent: lastEvaluation.timeSpent,
      
      // Explanation
      explanation: mcqData.explanation,
      
      // Submission timestamp
      submittedAt: lastEvaluation.submittedAt,
    };
  } catch (error) {
    console.error('getLastAttemptedMCQ Error:', error);
    throw error;
  }
};

/**
 * Get last attempted MCQ by subject/chapter
 */
const getLastAttemptedMCQByFilter = async (userId, filters) => {
  try {
    const query = { userId };
    if (filters.subject) query.subject = filters.subject;
    if (filters.chapter) query.chapter = filters.chapter;
    if (filters.unit) query.unit = filters.unit;

    // ✅ GET LATEST EVALUATION WITH FILTERS
    const lastEvaluation = await MCQEvaluation.findOne(query)
      .sort({ submittedAt: -1 })
      .lean();

    if (!lastEvaluation) {
      return null;
    }

    // ✅ GET MCQ DATA
    const mcqGeneration = await MCQGeneration.findOne(
      { 'mcqData.mcqId': lastEvaluation.mcqId },
      { 'mcqData.$': 1 }
    ).lean();

    if (!mcqGeneration || !mcqGeneration.mcqData || mcqGeneration.mcqData.length === 0) {
      return null;
    }

    const mcqData = mcqGeneration.mcqData[0];

    return {
      mcqId: lastEvaluation.mcqId,
      questionNumber: lastEvaluation.questionNumber,
      question: mcqData.question,
      options: mcqData.options,
      difficulty: mcqData.difficulty,
      subject: lastEvaluation.subject,
      chapter: lastEvaluation.chapter,
      unit: lastEvaluation.unit || 'N/A',
      userAnswer: lastEvaluation.userAnswer,
      correctAnswer: lastEvaluation.correctAnswer,
      isCorrect: lastEvaluation.isCorrect,
      score: lastEvaluation.score,
      timeSpent: lastEvaluation.timeSpent,
      explanation: mcqData.explanation,
      submittedAt: lastEvaluation.submittedAt,
    };
  } catch (error) {
    console.error('getLastAttemptedMCQByFilter Error:', error);
    throw error;
  }
};

/**
 * Get last N attempted MCQs
 */
const getLastNAttemptedMCQs = async (userId, limit = 5) => {
  try {
    // ✅ GET LAST N EVALUATIONS
    const lastEvaluations = await MCQEvaluation.find({ userId })
      .sort({ submittedAt: -1 })
      .limit(parseInt(limit))
      .lean();

    if (lastEvaluations.length === 0) {
      return [];
    }

    // ✅ GET MCQ DATA FOR ALL EVALUATIONS IN ONE QUERY
    const mcqIds = lastEvaluations.map(e => e.mcqId);
    const mcqGenerations = await MCQGeneration.find(
      { 'mcqData.mcqId': { $in: mcqIds } },
      { 'mcqData': 1 }
    ).lean();

    const mcqDataMap = {};
    for (const gen of mcqGenerations) {
      for (const item of gen.mcqData || []) {
        if (item.mcqId) mcqDataMap[item.mcqId] = item;
      }
    }

    const results = lastEvaluations.map((evaluation) => {
      const mcqData = mcqDataMap[evaluation.mcqId];
      if (!mcqData) return null;

      return {
        mcqId: evaluation.mcqId,
        questionNumber: evaluation.questionNumber,
        question: mcqData.question,
        options: mcqData.options,
        difficulty: mcqData.difficulty,
        subject: evaluation.subject,
        chapter: evaluation.chapter,
        unit: evaluation.unit || 'N/A',
        userAnswer: evaluation.userAnswer,
        correctAnswer: evaluation.correctAnswer,
        isCorrect: evaluation.isCorrect,
        score: evaluation.score,
        timeSpent: evaluation.timeSpent,
        explanation: mcqData.explanation,
        submittedAt: evaluation.submittedAt,
      };
    });

    // Filter out null results
    return results.filter((r) => r !== null);
  } catch (error) {
    console.error('getLastNAttemptedMCQs Error:', error);
    throw error;
  }
};

/* module.exports = {
  // ... existing exports
  getLastAttemptedMCQ,
  getLastAttemptedMCQByFilter,
  getLastNAttemptedMCQs,
};
 */


module.exports = {
  generateMCQsFromPython,
  saveMCQGeneration,
  getMCQData,
  submitMCQAnswer,
  updateProgress,
  getUserResults,
  getLastAttemptedMCQ,
  getLastAttemptedMCQByFilter,
  getLastNAttemptedMCQs,
};