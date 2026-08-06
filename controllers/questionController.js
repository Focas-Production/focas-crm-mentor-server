const Question = require("../models/Question");
const File = require("../models/File");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs").promises;
const path = require("path");
const { incrementQueryCount } = require("../middleware/queryLimiter");

// Create Question
exports.createQuestion = async (req, res) => {
  try {
    const { sessionId, questionType, inputType, content, topic, fileId } =
      req.validatedData;

    const question = await Question.create({
      questionId: uuidv4(),
      sessionId,
      userId: req.user.userId,
      questionType,
      inputType,
      content,
      topic,
      fileId: fileId || null,
    });

    // Increment query counts for subscription and usage
    await incrementQueryCount(req);

    // console.log('Backend response for create new questions:', JSON.stringify(question, null, 2));

    res.status(201).json(question);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Get all questions for a session
exports.getQuestionsBySession = async (req, res) => {
  try {
    const { sessionId } = req.params;
    // console.log("Session ID: ", sessionId);

    const questions = await Question.find({
      sessionId,
      userId: req.user.userId,
    })
      .sort({ createdAt: 1 })
      .populate({
        path: "fileId",
        foreignField: "fileId",
        localField: "fileId",
      });

    // console.log('Backend response for questions:', questions);
    res.status(200).json(questions);
  } catch (err) {
    // console.error("Error in getQuestionsBySession:", err);
    res.status(500).json({ error: err.message });
  }
};

// Get single question
exports.getQuestionById = async (req, res) => {
  try {
    const { questionId } = req.params;

    const question = await Question.findOne({
      questionId,
      userId: req.user.userId,
    });
    if (!question)
      return res.status(404).json({ message: "Question not found" });

    res.status(200).json(question);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Update question
exports.updateQuestion = async (req, res) => {
  try {
    const { questionId } = req.params;
    const { questionType, inputType, content, topic, fileId } = req.body;

    const question = await Question.findOneAndUpdate(
      { questionId, userId: req.user.userId },
      {
        ...(questionType && { questionType }),
        ...(inputType && { inputType }),
        ...(content && { content }),
        ...(topic && { topic }),
        ...(fileId && { fileId }),
      },
      { new: true }
    );

    if (!question)
      return res.status(404).json({ message: "Question not found" });
    res.status(200).json(question);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Delete question
exports.deleteQuestion = async (req, res) => {
  try {
    const { questionId } = req.params;

    const deleted = await Question.findOneAndDelete({
      questionId,
      userId: req.user.userId,
    });
    if (!deleted)
      return res.status(404).json({ message: "Question not found" });

    // Get all files linked to this question to delete physical files
    const files = await File.find({ questionId });

    // Delete physical files from uploads folder
    for (const file of files) {
      try {
        // Check if file exists before attempting to delete
        await fs.access(file.filePath);
        await fs.unlink(file.filePath);
        console.log(`Deleted file: ${file.filePath}`);
      } catch (fileErr) {
        // File might not exist or already deleted, log warning but continue
        console.warn(
          `Could not delete file ${file.filePath}:`,
          fileErr.message
        );
      }
    }

    // Delete file records from database
    await File.deleteMany({ questionId });

    res
      .status(200)
      .json({ message: "Question and associated files deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ===== ADMIN FUNCTIONS =====

// Get questions for any session (admin access)
exports.getSessionQuestionsAdmin = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const questions = await Question.find({ sessionId })
      .sort({ createdAt: 1 })
      .populate({
        path: "fileId",
        foreignField: "fileId",
        localField: "fileId",
      });

    res.status(200).json(questions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
