const mcqService = require('../services/mcqService');
const { validatePagination } = require('../utils/validators');

const getUserResults = async (req, res) => {
  try {
   const userId = req.user.userId;
      // const userId = "ce1530e5-4993-4e1b-8248-a8b5e200dcc5"
    const { subject, chapter, unit, limit = 10, page = 1 } = req.query;

    // ✅ VALIDATE PAGINATION
    const pagination = validatePagination(limit, page);
    if (!pagination.valid) {
      return res.status(400).json({ success: false, error: pagination.error });
    }

    // ✅ GET RESULTS
    const { results, total, pages } = await mcqService.getUserResults(
      userId,
      { subject, chapter, unit },
      pagination.limit,
      pagination.page
    );

    res.json({
      success: true,
      total,
      page: pagination.page,
      limit: pagination.limit,
      pages,
      data: results.map(r => ({
        mcqId: r.mcqId,
        subject: r.subject,
        chapter: r.chapter,
        unit: r.unit || 'N/A',
        userAnswer: r.userAnswer,
        correctAnswer: r.correctAnswer,
        isCorrect: r.isCorrect,
        score: r.score,
        timeSpent: r.timeSpent,
        submittedAt: r.submittedAt,
      })),
    });
  } catch (error) {
    console.error('getUserResults Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * GET LAST ATTEMPTED MCQ
 * GET /api/mcq/last-attempted
 */
const getLastAttempted = async (req, res) => {
  try {
    const userId = req.user.userId;
    // const userId = "ce1530e5-4993-4e1b-8248-a8b5e200dcc5"

    const lastMcq = await mcqService.getLastAttemptedMCQ(userId);

    if (!lastMcq) {
      return res.status(404).json({
        success: false,
        error: 'No MCQ attempted yet',
      });
    }

    res.json({
      success: true,
      data: lastMcq,
    });
  } catch (error) {
    console.error('getLastAttempted Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * GET LAST ATTEMPTED MCQ BY FILTER (subject/chapter/unit)
 * GET /api/mcq/last-attempted?subject=Accounting&chapter=Chapter%201
 */
const getLastAttemptedByFilter = async (req, res) => {
  try {
    const userId = req.user.userId;
   // const userId = "ce1530e5-4993-4e1b-8248-a8b5e200dcc5"
    const { subject, chapter, unit } = req.query;

    const lastMcq = await mcqService.getLastAttemptedMCQByFilter(userId, {
      subject,
      chapter,
      unit,
    });

    if (!lastMcq) {
      return res.status(404).json({
        success: false,
        error: 'No MCQ attempted for the given filter',
      });
    }

    res.json({
      success: true,
      data: lastMcq,
    });
  } catch (error) {
    console.error('getLastAttemptedByFilter Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * GET LAST N ATTEMPTED MCQs
 * GET /api/mcq/last-attempted-list?limit=5
 */
const getLastAttemptedList = async (req, res) => {
  try {
    const userId = req.user.userId;
    // const userId = "ce1530e5-4993-4e1b-8248-a8b5e200dcc5"
    const { limit = 5 } = req.query;

    const lastMcqs = await mcqService.getLastNAttemptedMCQs(userId, limit);

    if (lastMcqs.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No MCQ attempted yet',
      });
    }

    res.json({
      success: true,
      count: lastMcqs.length,
      data: lastMcqs,
    });
  } catch (error) {
    console.error('getLastAttemptedList Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/* module.exports = {
  // ... existing exports
  getLastAttempted,
  getLastAttemptedByFilter,
  getLastAttemptedList,
}; */

module.exports = { getUserResults,
   getLastAttempted,
  getLastAttemptedByFilter,
  getLastAttemptedList,
};