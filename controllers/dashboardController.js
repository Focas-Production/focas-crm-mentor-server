const MCQEvaluation = require('../models/MCQEvaluation');
const MCQProgress = require('../models/MCQProgress');
const limitService = require('../services/limitService');
const User = require('../models/User');
const { validatePagination } = require('../utils/validators');
const Subscription = require("../models/Subscription");

const getDashboard = async (req, res) => {
  try {
  const userId = req.user.userId;

     // const userId = "ce1530e5-4993-4e1b-8248-a8b5e200dcc5"

    // ✅ GET USER
    const user = await User.findOne({ userId });
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

      const subscription = await Subscription.findOne({
                    userId,
                    status: "active",
                    endDate: { $gt: new Date() },
                  }).sort({ createdAt: -1 });
        
        console.log('User Subscription:', subscription);


    // ✅ GET LIMITS
    const limits = await limitService.resetLimitsIfNeeded(userId, subscription?.plan ?? "free");

    // ✅ GET STATS
    const totalEvaluations = await MCQEvaluation.countDocuments({ userId });
    const correctEvaluations = await MCQEvaluation.countDocuments({ userId, isCorrect: true });
    const avgScore = totalEvaluations > 0 ? Math.round((correctEvaluations / totalEvaluations) * 100) : 0;

    // ✅ GET PROGRESS BY SUBJECT/CHAPTER
    const progressBySubject = await MCQProgress.find({ userId }).lean();

    res.json({
      success: true,
      user: {
        userId: user.userId,
        email: user.email,
        name: user.name,
        subscription: subscription?.plan ?? "free",
      },
      stats: {
        totalEvaluations,
        correctAnswers: correctEvaluations,
        averageScore: avgScore,
        accuracyPercentage: avgScore,
      },
      limits: {
        generation: {
          daily: {
            limit: limits.dailyLimit,
            used: limits.generatedToday,
            remaining: limits.dailyLimit - limits.generatedToday,
          },
          monthly: {
            limit: limits.monthlyLimit,
            used: limits.generatedThisMonth,
            remaining: limits.monthlyLimit - limits.generatedThisMonth,
          },
        },
        evaluation: {
          daily: {
            limit: limits.evalDailyLimit,
            used: limits.evaluationsToday,
            remaining: limits.evalDailyLimit - limits.evaluationsToday,
          },
          monthly: {
            limit: limits.evalMonthlyLimit,
            used: limits.evaluationsThisMonth,
            remaining: limits.evalMonthlyLimit - limits.evaluationsThisMonth,
          },
        },
      },
      progress: progressBySubject.map(p => ({
        subject: p.subject,
        chapter: p.chapter,
        unit: p.unit || 'N/A',
        totalAttempted: p.totalAttempted,
        totalCorrect: p.totalCorrect,
        avgScore: p.avgScore,
        lastAttempted: p.lastAttempted,
      })),
    });
  } catch (error) {
    console.error('getDashboard Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const getProgressByFilter = async (req, res) => {
  try {
  const userId = req.user.userId;
    // const userId = "ce1530e5-4993-4e1b-8248-a8b5e200dcc5"

    const { subject, chapter, unit, limit = 10, page = 1 } = req.query;

    // ✅ VALIDATE PAGINATION
    const pagination = validatePagination(limit, page);
    if (!pagination.valid) {
      return res.status(400).json({ success: false, error: pagination.error });
    }

    // ✅ BUILD QUERY
    const query = { userId };
    if (subject) query.subject = subject;
    if (chapter) query.chapter = chapter;
    if (unit) query.unit = unit;

    const skip = (pagination.page - 1) * pagination.limit;

    // ✅ GET PROGRESS
    const progress = await MCQProgress.find(query)
      .sort({ lastAttempted: -1 })
      .limit(pagination.limit)
      .skip(skip)
      .lean();

    const total = await MCQProgress.countDocuments(query);

    res.json({
      success: true,
      total,
      page: pagination.page,
      limit: pagination.limit,
      pages: Math.ceil(total / pagination.limit),
      data: progress.map(p => ({
        subject: p.subject,
        chapter: p.chapter,
        unit: p.unit || 'N/A',
        totalAttempted: p.totalAttempted,
        totalCorrect: p.totalCorrect,
        avgScore: p.avgScore,
        successRate: Math.round((p.totalCorrect / p.totalAttempted) * 100),
        firstAttempted: p.firstAttempted,
        lastAttempted: p.lastAttempted,
      })),
    });
  } catch (error) {
    console.error('getProgressByFilter Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = { getDashboard, getProgressByFilter };