/*
FILE: src/services/limitService.js
Manages daily/monthly limits
*/

const MCQLimitUsage = require('../models/MCQLimitUsage');
const MCQ_CONFIG = require('../config/mcqConfig');
const { LimitExceededError } = require('../utils/errors');

const resetLimitsIfNeeded = async (userId, subscription) => {
  const now = new Date();
  let usage = await MCQLimitUsage.findOne({ userId });

  if (!usage) {
    usage = new MCQLimitUsage({
      userId,
      dailyResetDate: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      monthlyResetDate: new Date(now.getFullYear(), now.getMonth() + 1, 1),
      generatedToday: 0,
      evaluationsToday: 0,
      generatedThisMonth: 0,
      evaluationsThisMonth: 0,
      dailyLimit: MCQ_CONFIG[subscription].dailyLimit,
      monthlyLimit: MCQ_CONFIG[subscription].monthlyLimit,
      evalDailyLimit: MCQ_CONFIG[subscription].evaluationsDaily,
      evalMonthlyLimit: MCQ_CONFIG[subscription].evaluationsMonthly,
    });
    await usage.save();
    return usage;
  }

  // Reset daily if needed
  if (now >= usage.dailyResetDate) {
    usage.dailyResetDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    usage.generatedToday = 0;
    usage.evaluationsToday = 0;
  }

  // Reset monthly if needed
  if (now >= usage.monthlyResetDate) {
    usage.monthlyResetDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    usage.generatedThisMonth = 0;
    usage.evaluationsThisMonth = 0;
  }

  // Update limits if subscription changed
  usage.dailyLimit = MCQ_CONFIG[subscription].dailyLimit;
  usage.monthlyLimit = MCQ_CONFIG[subscription].monthlyLimit;
  usage.evalDailyLimit = MCQ_CONFIG[subscription].evaluationsDaily;
  usage.evalMonthlyLimit = MCQ_CONFIG[subscription].evaluationsMonthly;

  await usage.save();
  return usage;
};

const checkGenerationLimit = async (userId, subscription, requestedCount) => {
  const usage = await resetLimitsIfNeeded(userId, subscription);
  const config = MCQ_CONFIG[subscription];

  const remainingDaily = usage.dailyLimit - usage.generatedToday;
  const remainingMonthly = usage.monthlyLimit - usage.generatedThisMonth;

  if (remainingDaily <= 0) {
    throw new LimitExceededError('Daily generation limit reached', {
      dailyLimit: usage.dailyLimit,
      generatedToday: usage.generatedToday,
      remainingDaily: 0,
      monthlyLimit: usage.monthlyLimit,
      generatedThisMonth: usage.generatedThisMonth,
      remainingMonthly,
    });
  }

  if (remainingMonthly <= 0) {
    throw new LimitExceededError('Monthly generation limit reached', {
      dailyLimit: usage.dailyLimit,
      generatedToday: usage.generatedToday,
      remainingDaily,
      monthlyLimit: usage.monthlyLimit,
      generatedThisMonth: usage.generatedThisMonth,
      remainingMonthly: 0,
    });
  }

  // Auto-adjust if requesting more than available
  let toGenerate = Math.min(requestedCount, remainingDaily, remainingMonthly);

  return {
    usage,
    toGenerate,
    adjusted: toGenerate < requestedCount,
    remainingDaily,
    remainingMonthly,
  };
};

const checkEvaluationLimit = async (userId, subscription) => {
  const usage = await resetLimitsIfNeeded(userId, subscription);

  const remainingDaily = usage.evalDailyLimit - usage.evaluationsToday;
  const remainingMonthly = usage.evalMonthlyLimit - usage.evaluationsThisMonth;

  if (remainingDaily <= 0) {
    throw new LimitExceededError('Daily evaluation limit reached', {
      evalDailyLimit: usage.evalDailyLimit,
      evaluationsToday: usage.evaluationsToday,
      remainingDaily: 0,
      evalMonthlyLimit: usage.evalMonthlyLimit,
      evaluationsThisMonth: usage.evaluationsThisMonth,
      remainingMonthly,
    });
  }

  if (remainingMonthly <= 0) {
    throw new LimitExceededError('Monthly evaluation limit reached', {
      evalDailyLimit: usage.evalDailyLimit,
      evaluationsToday: usage.evaluationsToday,
      remainingDaily,
      evalMonthlyLimit: usage.evalMonthlyLimit,
      evaluationsThisMonth: usage.evaluationsThisMonth,
      remainingMonthly: 0,
    });
  }

  return usage;
};

const incrementGenerated = async (userId, count) => {
  return await MCQLimitUsage.findOneAndUpdate(
    { userId },
    {
      $inc: {
        generatedToday: count,
        generatedThisMonth: count,
      },
    },
    { new: true }
  );
};

const incrementEvaluations = async (userId, count = 1) => {
  return await MCQLimitUsage.findOneAndUpdate(
    { userId },
    {
      $inc: {
        evaluationsToday: count,
        evaluationsThisMonth: count,
      },
    },
    { new: true }
  );
};

module.exports = {
  resetLimitsIfNeeded,
  checkGenerationLimit,
  checkEvaluationLimit,
  incrementGenerated,
  incrementEvaluations,
};
