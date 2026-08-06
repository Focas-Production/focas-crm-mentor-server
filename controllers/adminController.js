const User = require('../models/User');
const Session = require('../models/Session'); // Make sure to require Session model
const Question = require('../models/Question'); // Make sure to require Question model
const QueryUsage = require('../models/QueryUsage');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const DAILY_QUERY_LIMIT = 7;
const MONTHLY_QUERY_LIMIT = 70;

// Get all users for dashboard (exam dates for calendar UI)
exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.find({}, {
      userId: 1,
      name: 1,
      phoneNumber: 1,
      city: 1,
      caLevel: 1,
      examDate: 1,
      createdAt: 1
    }).sort({ examDate: 1 }); // Sort by exam date for calendar view
    
    if (!users || users.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No users found',
        data: [],
        count: 0
      });
    }

    res.status(200).json({
      success: true,
      message: 'Users retrieved successfully',
      data: users,
      count: users.length
    });

  } catch (error) {
    console.error('Error in getAllUsers:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve users',
      message: 'Internal server error occurred while fetching users'
    });
  }
};

// Get users by exam date range for calendar view
exports.getUsersByExamDateRange = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    // Validate date parameters
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: 'Missing date parameters',
        message: 'Both startDate and endDate are required (YYYY-MM-DD format)'
      });
    }

    // Validate date format
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({
        success: false,
        error: 'Invalid date format',
        message: 'Please provide dates in YYYY-MM-DD format'
      });
    }

    if (start > end) {
      return res.status(400).json({
        success: false,
        error: 'Invalid date range',
        message: 'Start date must be before or equal to end date'
      });
    }

    const users = await User.find({
      examDate: {
        $gte: start,
        $lte: end
      }
    }, {
      userId: 1,
      name: 1,
      phoneNumber: 1,
      city: 1,
      caLevel: 1,
      examDate: 1
    }).sort({ examDate: 1 });

    res.status(200).json({
      success: true,
      message: 'Users retrieved successfully for date range',
      data: users,
      count: users.length,
      dateRange: {
        startDate: startDate,
        endDate: endDate
      }
    });

  } catch (error) {
    console.error('Error in getUsersByExamDateRange:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve users by date range',
      message: 'Internal server error occurred while fetching users'
    });
  }
};

// Get dashboard statistics
exports.getDashboardStats = async (req, res) => {
  try {
    const totalUsers = await User.countDocuments({});
    const usersWithExamDate = await User.countDocuments({ examDate: { $exists: true, $ne: null } });
    const usersByLevel = await User.aggregate([
      {
        $group: {
          _id: '$caLevel',
          count: { $sum: 1 }
        }
      }
    ]);

    res.status(200).json({
      success: true,
      message: 'Dashboard statistics retrieved successfully',
      data: {
        totalUsers,
        usersWithExamDate,
        usersByLevel: usersByLevel.reduce((acc, item) => {
          acc[item._id || 'Not Set'] = item.count;
          return acc;
        }, {})
      }
    });

  } catch (error) {
    console.error('Error in getDashboardStats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve dashboard statistics',
      message: 'Internal server error occurred while fetching statistics'
    });
  }
};

exports.getComprehensiveAdminData = async (req, res) => {
  try {
    const users = await User.find({}, {
      userId: 1, name: 1, phoneNumber: 1, city: 1, caLevel: 1, examDate: 1
    }).lean();

    const userIds = users.map(u => u.userId);

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);
    const month = `${startOfDay.getFullYear()}-${String(startOfDay.getMonth() + 1).padStart(2, '0')}`;

    // 3 bulk queries instead of N×5
    const [allSessions, questionCounts, usageData] = await Promise.all([
      Session.find({ userId: { $in: userIds } }, { userId: 1, sessionId: 1, createdAt: 1 }).lean(),
      Question.aggregate([
        { $match: {} },
        { $group: { _id: '$sessionId', count: { $sum: 1 } } }
      ]),
      QueryUsage.aggregate([
        { $match: { userId: { $in: userIds } } },
        {
          $group: {
            _id: '$userId',
            dailyCount: {
              $sum: {
                $cond: [
                  { $and: [{ $gte: ['$date', startOfDay] }, { $lte: ['$date', endOfDay] }] },
                  '$dailyCount',
                  0
                ]
              }
            },
            monthlyCount: {
              $sum: {
                $cond: [{ $eq: ['$month', month] }, '$dailyCount', 0]
              }
            },
            monthlyCountField: { $max: '$monthlyCount' }
          }
        }
      ])
    ]);

    // Build lookup maps in JS
    const sessionsByUser = {};
    for (const s of allSessions) {
      if (!sessionsByUser[s.userId]) sessionsByUser[s.userId] = [];
      sessionsByUser[s.userId].push(s);
    }

    const questionsBySession = {};
    for (const q of questionCounts) {
      questionsBySession[q._id] = q.count;
    }

    const usageByUser = {};
    for (const u of usageData) {
      usageByUser[u._id] = u;
    }

    const comprehensiveData = users.map((user) => {
      const sessions = sessionsByUser[user.userId] || [];
      const sessionIds = sessions.map(s => s.sessionId);
      const totalQuestions = sessionIds.reduce((sum, sid) => sum + (questionsBySession[sid] || 0), 0);
      const lastSession = sessions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
      const usage = usageByUser[user.userId];
      const dailyQueryCount = usage ? usage.dailyCount : 0;
      const monthlyQueryCount = usage ? Math.max(usage.monthlyCount, usage.monthlyCountField || 0) : 0;

      return {
        userId: user.userId,
        name: user.name || 'N/A',
        phone: user.phoneNumber || 'N/A',
        city: user.city || 'Not Set',
        level: user.caLevel || 'Not Set',
        examMonth: user.examDate
          ? new Date(user.examDate).toLocaleString('default', { month: 'long', year: 'numeric' })
          : 'Not Set',
        sessionCount: sessions.length,
        lastSessionDate: lastSession ? lastSession.createdAt : null,
        totalQuestions,
        dailyQueryCount,
        monthlyQueryCount,
      };
    });

    res.status(200).json(comprehensiveData);

  } catch (error) {
    console.error('Error fetching comprehensive admin data:', error);
    res.status(500).json({ error: 'Failed to fetch admin data' });
  }
};

exports.checkQueryLimits = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    
    // Get or create usage record for today
    let dailyUsage = await QueryUsage.findOne({ 
      userId, 
      date: today 
    });
    
    if (!dailyUsage) {
      dailyUsage = await QueryUsage.create({
        userId,
        date: today,
        month,
        dailyCount: 0
      });
    }
    
    // Calculate monthly usage by aggregating all days in this month
    const monthlyAggregation = await QueryUsage.aggregate([
      {
        $match: {
          userId,
          month
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$dailyCount' }
        }
      }
    ]);
    
    const monthlyTotal = monthlyAggregation.length > 0 ? monthlyAggregation[0].total : 0;
    
    // Check daily limit
    if (dailyUsage.dailyCount >= DAILY_QUERY_LIMIT) {
      return res.status(429).json({
        error: 'Daily query limit exceeded',
        message: `You have reached your daily limit of ${DAILY_QUERY_LIMIT} queries. Please try again tomorrow.`,
        limits: {
          daily: { used: dailyUsage.dailyCount, limit: DAILY_QUERY_LIMIT },
          monthly: { used: monthlyTotal, limit: MONTHLY_QUERY_LIMIT }
        }
      });
    }
    
    // Check monthly limit
    if (monthlyTotal >= MONTHLY_QUERY_LIMIT) {
      return res.status(429).json({
        error: 'Monthly query limit exceeded',
        message: `You have reached your monthly limit of ${MONTHLY_QUERY_LIMIT} queries. Please wait until next month.`,
        limits: {
          daily: { used: dailyUsage.dailyCount, limit: DAILY_QUERY_LIMIT },
          monthly: { used: monthlyTotal, limit: MONTHLY_QUERY_LIMIT }
        }
      });
    }
    
    req.queryUsage = {
      dailyUsage,
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
// Admin login - only one specific credential allowed
exports.adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Check if admin credentials are provided
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Missing credentials',
        message: 'Email and password are required'
      });
    }

    // For now, you can set a specific admin email in your .env file
    // and check against it. Later you can implement proper password hashing
    const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@focas.com';
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
    
    if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
      return res.status(401).json({
        success: false,
        error: 'Authentication failed',
        message: 'Invalid admin credentials'
      });
    }

    // Find or create admin user
    let user = await User.findOne({ email: email.toLowerCase() });
    
    if (!user) {
      // Create admin user if it doesn't exist
      const { v4: uuidv4 } = require('uuid');
      user = new User({
        userId: uuidv4(),
        email: email.toLowerCase(),
        name: 'Admin User',
        isAdmin: true,
        createdAt: new Date(),
        profileCompleted: true
      });
      await user.save();
      console.log('Admin user created successfully');
    } else if (!user.isAdmin) {
      // Update existing user to admin
      user.isAdmin = true;
      await user.save();
      console.log('User updated to admin successfully');
    }

    // Create JWT token for admin
    const token = jwt.sign(
      { userId: user.userId, email: user.email, isAdmin: true },
      process.env.JWT_SECRET,
      { expiresIn: '20d' }
    );

    res.status(200).json({
      success: true,
      message: 'Admin login successful',
      data: {
        token,
        user: {
          userId: user.userId,
          name: user.name,
          email: user.email,
          isAdmin: user.isAdmin
        }
      }
    });

  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({
      success: false,
      error: 'Login failed',
      message: 'Internal server error occurred during login'
    });
  }
};