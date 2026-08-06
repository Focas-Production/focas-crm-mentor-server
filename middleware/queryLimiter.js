// const QueryUsage = require('../models/QueryUsage');

// exports.checkQueryLimits = async (req, res, next) => {
//   try {
//     const userId = req.user.userId;
//     const today = new Date();
//     today.setHours(0, 0, 0, 0); // Start of day
    
//     const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    
//     // Get or create usage record for today
//     let dailyUsage = await QueryUsage.findOne({ 
//       userId, 
//       date: today 
//     });
    
//     if (!dailyUsage) {
//       dailyUsage = await QueryUsage.create({
//         userId,
//         date: today,
//         month,
//         dailyCount: 0,
//         monthlyCount: 0
//       });
//     }
    
//     // Get monthly usage
//     let monthlyUsage = await QueryUsage.findOne({ 
//       userId, 
//       month 
//     });
    
//     if (!monthlyUsage) {
//       monthlyUsage = await QueryUsage.create({
//         userId,
//         date: today,
//         month,
//         dailyCount: 0,
//         monthlyCount: 0
//       });
//     }
    
//     // Check daily limit (7 queries)
//     if (dailyUsage.dailyCount >= 7) {
//       return res.status(429).json({
//         error: 'Daily query limit exceeded',
//         message: 'You have reached your daily limit of 7 queries. Please try again tomorrow.',
//         limits: {
//           daily: { used: dailyUsage.dailyCount, limit: 7 },
//           monthly: { used: monthlyUsage.monthlyCount, limit: 70 }
//         }
//       });
//     }
    
//     // Check monthly limit (70 queries)
//     if (monthlyUsage.monthlyCount >= 70) {
//       return res.status(429).json({
//         error: 'Monthly query limit exceeded',
//         message: 'You have reached your monthly limit of 70 queries. Please wait until next month.',
//         limits: {
//           daily: { used: dailyUsage.dailyCount, limit: 7 },
//           monthly: { used: monthlyUsage.monthlyCount, limit: 70 }
//         }
//       });
//     }
    
//     // Store usage info in request for later update
//     req.queryUsage = {
//       dailyUsage,
//       monthlyUsage,
//       userId,
//       today,
//       month
//     };
    
//     next();
//   } catch (error) {
//     console.error('Error checking query limits:', error);
//     res.status(500).json({ error: 'Failed to check query limits' });
//   }
// };


// middleware/checkQueryLimits.js
const QueryUsage = require('../models/QueryUsage');
const Subscription = require('../models/Subscription');

const DAILY_QUERY_LIMIT = 7;
const MONTHLY_QUERY_LIMIT = 70;

exports.checkQueryLimits = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    
    // Check for active Pro subscription
    const activeSubscription = await Subscription.findOne({
      userId,
      status: 'active',
      plan: 'pro',
      endDate: { $gt: new Date() }
    }).sort({ createdAt: -1 });
    
    // If user has Pro subscription, check Pro limits
    if (activeSubscription) {
      // Check if subscription has queries remaining
      if (activeSubscription.queriesUsed >= activeSubscription.monthlyQueryLimit) {
        return res.status(429).json({
          error: 'Monthly query limit exceeded',
          message: 'You have reached your Pro monthly limit of 2000 queries.',
          isPro: true,
          limits: {
            monthly: { 
              used: activeSubscription.queriesUsed, 
              limit: activeSubscription.monthlyQueryLimit,
              remaining: 0
            }
          },
          subscription: {
            endDate: activeSubscription.endDate,
            daysRemaining: Math.ceil((activeSubscription.endDate - new Date()) / (1000 * 60 * 60 * 24))
          }
        });
      }
      
      // Store Pro subscription info for later update
      req.queryUsage = {
        isPro: true,
        subscription: activeSubscription,
        userId
      };
      
      return next();
    }
    
    // Free user - check daily and monthly limits
    let dailyUsage = await QueryUsage.findOne({ 
      userId, 
      date: today 
    });
    
    if (!dailyUsage) {
      dailyUsage = await QueryUsage.create({
        userId,
        date: today,
        month,
        dailyCount: 0,
        monthlyCount: 0
      });
    }
    
    let monthlyUsage = await QueryUsage.findOne({ 
      userId, 
      month 
    });
    
    if (!monthlyUsage) {
      monthlyUsage = await QueryUsage.create({
        userId,
        date: today,
        month,
        dailyCount: 0,
        monthlyCount: 0
      });
    }
    
    // Check daily limit
    if (dailyUsage.dailyCount >= DAILY_QUERY_LIMIT) {
      return res.status(429).json({
        error: 'Daily query limit exceeded',
        message: `You have reached your daily limit of ${DAILY_QUERY_LIMIT} queries. Please try again tomorrow or upgrade to Pro.`,
        isPro: false,
        limits: {
          daily: { used: dailyUsage.dailyCount, limit: DAILY_QUERY_LIMIT, remaining: 0 },
          monthly: { used: monthlyUsage.monthlyCount, limit: MONTHLY_QUERY_LIMIT, remaining: Math.max(MONTHLY_QUERY_LIMIT - monthlyUsage.monthlyCount, 0) }
        },
        upgradeAvailable: true
      });
    }
    
    // Check monthly limit
    if (monthlyUsage.monthlyCount >= MONTHLY_QUERY_LIMIT) {
      return res.status(429).json({
        error: 'Monthly query limit exceeded',
        message: `You have reached your monthly limit of ${MONTHLY_QUERY_LIMIT} queries. Please wait until next month or upgrade to Pro.`,
        isPro: false,
        limits: {
          daily: { used: dailyUsage.dailyCount, limit: DAILY_QUERY_LIMIT, remaining: Math.max(DAILY_QUERY_LIMIT - dailyUsage.dailyCount, 0) },
          monthly: { used: monthlyUsage.monthlyCount, limit: MONTHLY_QUERY_LIMIT, remaining: 0 }
        },
        upgradeAvailable: true
      });
    }
    
    // Store usage info for later update
    req.queryUsage = {
      isPro: false,
      dailyUsage,
      monthlyUsage,
      userId,
      today,
      month
    };
    
    next();
  } catch (error) {
    console.error('Error checking query limits:', error);
    res.status(500).json({ error: 'Failed to check query limits' });
  }
};

// Helper function to increment query count after successful query
exports.incrementQueryCount = async (req) => {
  try {
    const { queryUsage } = req;
    
    if (!queryUsage) return;
    
    if (queryUsage.isPro && queryUsage.subscription) {
      // Increment Pro subscription query count
      queryUsage.subscription.queriesUsed += 1;
      queryUsage.subscription.updatedAt = new Date();
      await queryUsage.subscription.save();
      return;
    }

    // Free user - increment stored usage counters once
    const updates = [];

    if (queryUsage.dailyUsage?._id) {
      updates.push(
        QueryUsage.findByIdAndUpdate(queryUsage.dailyUsage._id, {
          $inc: { dailyCount: 1 },
        })
      );
    }

    if (queryUsage.monthlyUsage?._id) {
      updates.push(
        QueryUsage.findByIdAndUpdate(queryUsage.monthlyUsage._id, {
          $inc: { monthlyCount: 1 },
        })
      );
    }

    await Promise.all(updates);
  } catch (error) {
    console.error('Error incrementing query count:', error);
  }
};