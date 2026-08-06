require('dotenv').config();

const MCQ_CONFIG = {
  free: {
    dailyLimit: parseInt(process.env.FREE_DAILY_LIMIT || 5),
    monthlyLimit: parseInt(process.env.FREE_MONTHLY_LIMIT || 100),
    evaluationsDaily: parseInt(process.env.FREE_EVAL_DAILY || 10),
    evaluationsMonthly: parseInt(process.env.FREE_EVAL_MONTHLY || 200),
  },
  pro: {
    dailyLimit: parseInt(process.env.PREMIUM_DAILY_LIMIT || 50),
    monthlyLimit: parseInt(process.env.PREMIUM_MONTHLY_LIMIT || 1000),
    evaluationsDaily: parseInt(process.env.PREMIUM_EVAL_DAILY || 100),
    evaluationsMonthly: parseInt(process.env.PREMIUM_EVAL_MONTHLY || 2000),
  },
};

module.exports = MCQ_CONFIG;