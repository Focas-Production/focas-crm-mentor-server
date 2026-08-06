const Session = require('../models/Session');
const Question = require('../models/Question');
const Response = require('../models/Response');
const File = require('../models/File');
const { v4: uuidv4 } = require('uuid');

// Create session
exports.createSession = async (req, res) => {
  try {
    const { sessionTitle } = req.validatedData;


    const newSession = await Session.create({
      sessionId: uuidv4(),
      userId: req.user.userId,  
      sessionTitle
    });

    res.status(201).json(newSession);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Get all sessions for a user
exports.getUserSessions = async (req, res) => {
  try {
    const sessions = await Session.find({ userId: req.user.userId }).sort({ createdAt: -1 });
    res.status(200).json(sessions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Get single session
exports.getSessionById = async (req, res) => {
  try {
    const session = await Session.findOne({
      sessionId: req.params.sessionId,
      userId: req.user.userId
    });

    if (!session) return res.status(404).json({ message: "Session not found" });
    res.status(200).json(session);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Update session (title or isCompleted)
exports.updateSession = async (req, res) => {
  try {
    const { sessionTitle, isCompleted } = req.body;

    const session = await Session.findOneAndUpdate(
      { 
        sessionId: req.params.sessionId, userId: req.user.userId
      },
      {
        ...(sessionTitle && { sessionTitle }),
        ...(typeof isCompleted === 'boolean' && { isCompleted }),
        lastActivityAt: new Date()
      },
      { new: true }
    );

    if (!session) return res.status(404).json({ message: "Session not found" });
    res.status(200).json(session);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Delete session
exports.deleteSession = async (req, res) => {
  try {
    const sessionId = req.params.sessionId;
    const userId = req.user.userId;

    const result = await Session.findOneAndDelete({ sessionId, userId });
    if (!result) return res.status(404).json({ message: "Session not found" });

    // Find all questions for this session
    const questions = await Question.find({ sessionId, userId });
    const questionIds = questions.map(q => q.questionId);

    // Find all files linked to these questions
    const files = await File.find({ questionId: { $in: questionIds } });

    // Delete physical files from uploads folder
    const fs = require('fs').promises;
    for (const file of files) {
      try {
        // Check if file exists before attempting to delete
        await fs.access(file.filePath);
        await fs.unlink(file.filePath);
        console.log(`Deleted file: ${file.filePath}`);
      } catch (fileErr) {
        // File might not exist or already deleted, log warning but continue
        console.warn(`Could not delete file ${file.filePath}:`, fileErr.message);
      }
    }

    // Delete all file records from database
    await File.deleteMany({ questionId: { $in: questionIds } });

    // Delete all responses for this session
    await Response.deleteMany({ sessionId, userId });

    // Delete all questions for this session
    await Question.deleteMany({ sessionId, userId });

    res.status(200).json({ message: "Session and all associated questions, responses, and files deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ===== ADMIN FUNCTIONS =====

// Get all sessions for admin dashboard
exports.getAllSessionsAdmin = async (req, res) => {
  try {
    const sessions = await Session.find({})
      .select('sessionId userId sessionTitle createdAt lastActivityAt isCompleted')
      .populate('userId', 'name email')
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();
    
    res.status(200).json(sessions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Get sessions for a specific user (admin access)
exports.getUserSessionsAdmin = async (req, res) => {
  try {
    const { userId } = req.params;
    const sessions = await Session.find({ userId })
      .sort({ createdAt: -1 });
    
    res.status(200).json(sessions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Get session count for a specific user (admin access)
exports.getUserSessionCountAdmin = async (req, res) => {
  try {
    const { userId } = req.params;
    const count = await Session.countDocuments({ userId });
    
    res.status(200).json({ count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
