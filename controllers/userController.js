// backend/controllers/userController.js
const User = require('../models/User');
const QueryUsage = require('../models/QueryUsage');

const DAILY_QUERY_LIMIT = 7;
const MONTHLY_QUERY_LIMIT = 70;

exports.updateUserProfile = async (req, res) => {
  try {
    const { name } = req.validatedData;

    // The user's ID is available from the 'protect' middleware (req.user.userId)
    const user = await User.findOne({ userId: req.user.userId });

    if (user) {
      user.name = name || user.name;
      const updatedUser = await user.save();

      res.status(200).json({
        userId: updatedUser.userId,
        name: updatedUser.name,
        email: updatedUser.email,
      });
    } else {
      res.status(404).json({ message: 'User not found' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get user's current query usage
exports.getQueryUsage = async (req, res) => {
  try {
    const userId = req.user.userId;
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Start of day
    
    const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    
    // Get daily usage
    let dailyUsage = await QueryUsage.findOne({ 
      userId, 
      date: today 
    });
    
    const dailyCount = dailyUsage?.dailyCount || 0;
    
    // Get monthly usage
    let monthlyUsage = await QueryUsage.findOne({ 
      userId, 
      month 
    });
    
    const monthlyCount = monthlyUsage?.monthlyCount || 0;
    
    res.status(200).json({
      daily: {
        used: dailyCount,
        limit: DAILY_QUERY_LIMIT,
        remaining: Math.max(DAILY_QUERY_LIMIT - dailyCount, 0)
      },
      monthly: {
        used: monthlyCount,
        limit: MONTHLY_QUERY_LIMIT,
        remaining: Math.max(MONTHLY_QUERY_LIMIT - monthlyCount, 0)
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};