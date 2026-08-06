const User = require('../models/User');

exports.checkProfileRequired = async (req, res, next) => {
  try {
    const user = await User.findOne({ userId: req.user.userId }).select('trialStartTime freeTrialUsed profileCompleted sessionSkipActive profileSkipped lastExamDateUpdate');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const now = new Date();
    const thirtyMinutesAfterCreation = new Date(user.trialStartTime.getTime() + 30 * 60 * 1000); // 30 minutes for production
    // const thirtyMinutesAfterCreation = new Date(user.trialStartTime.getTime() + 1 * 60 * 1000); // 1 minute for testing
    const isTrialActive = now < thirtyMinutesAfterCreation && !user.freeTrialUsed;

    // If trial is over and profile is not completed (but allow if session skip is active)
    if (!isTrialActive && !user.profileCompleted && !user.sessionSkipActive) {
      return res.status(403).json({
        error: 'Profile completion required',
        message: user.profileSkipped 
          ? 'You have used your one-time skip. Please complete your profile to continue using the application.'
          : 'Your free trial has ended. Please complete your profile to continue using the application.',
        requiresProfile: true,
        canSkip: !user.profileSkipped
      });
    }

    // Check if exam date reminder is needed
    if (user.profileCompleted && user.lastExamDateUpdate) {
      const needsExamDateUpdate = now > new Date(user.lastExamDateUpdate.getTime() + 45 * 24 * 60 * 60 * 1000); // 45 days for production
      // const needsExamDateUpdate = now > new Date(user.lastExamDateUpdate.getTime() + 5 * 60 * 1000); // 5 minutes for testing
      if (needsExamDateUpdate) {
        return res.status(403).json({
          error: 'Exam date update required',
          message: 'Please update your exam date to continue. It\'s been 5 minutes since your last update (testing mode).',
          requiresExamDateUpdate: true
        });
      }
    }

    next();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
