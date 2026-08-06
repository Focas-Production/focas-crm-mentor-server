/*
FILE: src/utils/validators.js
Production-level validation
*/

const validateMCQGenerate = (data) => {
  if (!data.level || typeof data.level !== 'string') {
    return { valid: false, error: 'Invalid or missing level' };
  }
  if (!data.subject || typeof data.subject !== 'string') {
    return { valid: false, error: 'Invalid or missing subject' };
  }
  if (!data.chapter || typeof data.chapter !== 'string') {
    return { valid: false, error: 'Invalid or missing chapter' };
  }
  if (!data.difficulty || !['easy', 'medium', 'hard','very-hard'].includes(data.difficulty)) {
    return { valid: false, error: 'Invalid difficulty level' };
  }
  
  const numQuestions = parseInt(data.numQuestions) || 1;
  if (numQuestions < 1 || numQuestions > 100) {
    return { valid: false, error: 'numQuestions must be between 1 and 100' };
  }
  
  return { valid: true, numQuestions };
};

const validateMCQEvaluation = (data) => {
  if (!data.mcqId || typeof data.mcqId !== 'string') {
    return { valid: false, error: 'Invalid or missing mcqId' };
  }
  if (!data.userAnswer || typeof data.userAnswer !== 'string') {
    return { valid: false, error: 'Invalid or missing userAnswer' };
  }
  if (!data.correctAnswer || typeof data.correctAnswer !== 'string') {
    return { valid: false, error: 'Invalid or missing correctAnswer' };
  }
  
  return { valid: true };
};

const validatePagination = (limit, page) => {
  const l = parseInt(limit) || 10;
  const p = parseInt(page) || 1;
  
  if (l < 1 || l > 100) return { valid: false, error: 'Limit must be 1-100' };
  if (p < 1) return { valid: false, error: 'Page must be >= 1' };
  
  return { valid: true, limit: l, page: p };
};

module.exports = {
  validateMCQGenerate,
  validateMCQEvaluation,
  validatePagination,
};