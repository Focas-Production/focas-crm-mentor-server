const Response = require('../models/Response');
const { v4: uuidv4 } = require('uuid');

// Create Response
exports.createResponse = async (req, res) => {
  try {
    const { sessionId, questionId, responseType, content, isStepByStep } = req.validatedData;

    const response = await Response.create({
      responseId: uuidv4(),
      sessionId,
      questionId,
      userId: req.user.userId,
      responseType,
      content,
      isStepByStep: isStepByStep || false
    });

    res.status(201).json(response);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Get all responses for a session
exports.getResponsesBySession = async (req, res) => {
  try {
    const { sessionId } = req.params;

    const responses = await Response.find({ sessionId, userId: req.user.userId });
    res.status(200).json(responses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Get responses by question
exports.getResponsesByQuestion = async (req, res) => {
  try {
    const { questionId } = req.params;

    const responses = await Response.find({ questionId, userId: req.user.userId });
    res.status(200).json(responses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Get single response
exports.getResponseById = async (req, res) => {
  try {
    const { responseId } = req.params;

    const response = await Response.findOne({ responseId, userId: req.user.userId });
    if (!response) return res.status(404).json({ message: 'Response not found' });

    res.status(200).json(response);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Delete response
exports.deleteResponse = async (req, res) => {
  try {
    const { responseId } = req.params;

    const result = await Response.findOneAndDelete({ responseId, userId: req.user.userId });
    if (!result) return res.status(404).json({ message: 'Response not found' });

    res.status(200).json({ message: 'Response deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ===== ADMIN FUNCTIONS =====

// Get responses for any session (admin access)
exports.getSessionResponsesAdmin = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const responses = await Response.find({ sessionId })
      .sort({ createdAt: 1 });
    
    res.status(200).json(responses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
