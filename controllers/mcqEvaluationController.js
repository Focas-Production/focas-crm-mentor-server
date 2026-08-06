const limitService = require('../services/limitService');
const mcqService = require('../services/mcqService');
const { validateMCQEvaluation } = require('../utils/validators');
const User = require('../models/User');
const Subscription = require("../models/Subscription");

const submitAnswer = async (req, res) => {
  try {
    const userId = req.user.userId;
  // const userId = "ce1530e5-4993-4e1b-8248-a8b5e200dcc5"
    const { mcqId, userAnswer, chapter, unit, timeSpent= 30 } = req.body;

    // ✅ VALIDATE INPUT
    if (!mcqId || typeof mcqId !== 'string') {
      return res.status(400).json({ success: false, error: 'Invalid mcqId' });
    }
    if (!userAnswer || typeof userAnswer !== 'string') {
      return res.status(400).json({ success: false, error: 'Invalid userAnswer' });
    }

    // ✅ GET USER
    const user = await User.findOne({ userId });
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // CHECK SUBSCRIPTION

     const subscription = await Subscription.findOne({
                userId,
                status: "active",
                endDate: { $gt: new Date() },
              }).sort({ createdAt: -1 });
    
    console.log('User Subscription:', subscription);

    // ✅ CHECK EVALUATION LIMIT
    const limitCheck = await limitService.checkEvaluationLimit(userId, subscription?.plan ?? "free");

    // ✅ SUBMIT ANSWER (gets correctAnswer from DB)
    const result = await mcqService.submitMCQAnswer(
      userId,
      mcqId,
      userAnswer,
      { chapter, unit, timeSpent }
    );

    // ✅ INCREMENT USAGE
    await limitService.incrementEvaluations(userId);

    // ✅ SEND RESPONSE
    res.json({
      success: true,
      isCorrect: result.evaluation.isCorrect,
      score: result.evaluation.score,
      message: result.evaluation.isCorrect ? '✅ Correct!' : '❌ Incorrect',
      question: result.question,
      // ✅ RETURN correctAnswer AND explanation for review
      correctAnswer: result.evaluation.correctAnswer,
      explanation: result.explanation,
      userAnswer: result.evaluation.userAnswer,
      limits: {
        evaluations: {
          daily: {
            limit: limitCheck.evalDailyLimit,
            used: limitCheck.evaluationsToday + 1,
            remaining: limitCheck.evalDailyLimit - (limitCheck.evaluationsToday + 1),
          },
          monthly: {
            limit: limitCheck.evalMonthlyLimit,
            used: limitCheck.evaluationsThisMonth + 1,
            remaining: limitCheck.evalMonthlyLimit - (limitCheck.evaluationsThisMonth + 1),
          },
        },
      },
    });
  } catch (error) {
    console.error('submitAnswer Error:', error);
    const status = error.status || 500;
    res.status(status).json({ success: false, error: error.message });
  }
};

module.exports = { submitAnswer };