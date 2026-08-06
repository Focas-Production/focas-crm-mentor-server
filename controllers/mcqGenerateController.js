const limitService = require('../services/limitService');
const mcqService = require('../services/mcqService');
const { validateMCQGenerate } = require('../utils/validators');
const User = require('../models/User');
const PREMIUM_CHAPTERS = require('../config/premiumChapters');
const Subscription = require("../models/Subscription");
const crypto = require("crypto");

const generateMCQ = async (req, res) => {
  try {
    const userId = req.user.userId;
    // Uncomment line below to test with hardcoded userId
     // const userId = "ce1530e5-4993-4e1b-8248-a8b5e200dcc5";

    const { level, subject, chapter, unit, difficulty, numQuestions } = req.body;

    // ✅ VALIDATE INPUT
    const validation = validateMCQGenerate({
      level,
      subject,
      chapter,
      difficulty,
      numQuestions,
    });
    if (!validation.valid) {
      return res.status(400).json({ success: false, error: validation.error });
    }

    // ✅ GET USER & CHECK SUBSCRIPTION
    const user = await User.findOne({ userId });
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

      // ✅ CHECK PREMIUM CHAPTER ACCESS

          const subscription = await Subscription.findOne({
            userId,
            status: "active",
            endDate: { $gt: new Date() },
          }).sort({ createdAt: -1 });

          console.log('User Subscription:', subscription);

          
    const premiumChapters = PREMIUM_CHAPTERS[subject] || [];
    if (premiumChapters.includes(chapter) && (!subscription || subscription.plan !== 'pro')) {
      return res.status(403).json({ 
        success: false, 
        error: `This chapter requires Premium subscription`,
        code: 'PREMIUM_REQUIRED'
      });
    }
    

    // ✅ CHECK LIMITS
    const limitCheck = await limitService.checkGenerationLimit(
      userId,
      subscription?.plan ?? "free",
      validation.numQuestions
    );
    console.log('Limit Check:', limitCheck);

    const toGenerate = limitCheck.toGenerate;
    console.log('Questions to Generate:', toGenerate);

    // ✅ CALL PYTHON API
    const pythonResponse = await mcqService.generateMCQsFromPython(
      level,
      subject,
      chapter,
      unit,
      difficulty,
      toGenerate
    );  
    if (!pythonResponse.success) {
      return res.status(500).json({ success: false, error: pythonResponse.error });
    }

    // ✅ GENERATE MCQ IDs
    // const mcqIds = pythonResponse.mcqs.map((_, i) => `mcq-${Date.now()}-${i}`);

    const mcqIds = pythonResponse.mcqs.map(() => crypto.randomUUID());

    // ✅ SAVE TO DATABASE (includes correctAnswer, explanation, etc.)
    await mcqService.saveMCQGeneration(
      userId,
      { level, subject, chapter, unit, difficulty },
      mcqIds,
      pythonResponse.mcqs
    );

    // ✅ INCREMENT USAGE
    await limitService.incrementGenerated(userId, toGenerate);

    // ✅ SEND RESPONSE (WITHOUT correctAnswer)
    res.json({
      success: true,
      count: toGenerate,
      adjusted: limitCheck.adjusted,
      mcqs: pythonResponse.mcqs.map((mcq, idx) => ({
        mcqId: mcqIds[idx],
        questionNumber: mcq.question_number || idx + 1,
        question: mcq.question,
        options: mcq.options,
        difficulty: mcq.difficulty,
        // ❌ DO NOT SEND correctAnswer HERE
        // correctAnswer is stored in DB only
      })),
      limits: {
        daily: {
          limit: limitCheck.usage.dailyLimit,
          used: limitCheck.usage.generatedToday + toGenerate,
          remaining: limitCheck.usage.dailyLimit - (limitCheck.usage.generatedToday + toGenerate),
        },
        monthly: {
          limit: limitCheck.usage.monthlyLimit,
          used: limitCheck.usage.generatedThisMonth + toGenerate,
          remaining: limitCheck.usage.monthlyLimit - (limitCheck.usage.generatedThisMonth + toGenerate),
        },
      },
    });
  } catch (error) {
    console.error('generateMCQ Error:', error);
    const status = error.status || 500;
    res.status(status).json({
      success: false,
      error: error.message,
      ...(error.limits && { limits: error.limits })
    });
  }
};

module.exports = { generateMCQ };