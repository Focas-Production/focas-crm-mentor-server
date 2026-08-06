/*
FILE: src/utils/errors.js
Custom error handling
*/

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
    this.name = 'ValidationError';
  }
}

class LimitExceededError extends Error {
  constructor(message, limits) {
    super(message);
    this.status = 429;
    this.name = 'LimitExceededError';
    this.limits = limits;
  }
}

class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.status = 404;
    this.name = 'NotFoundError';
  }
}

class DuplicateSubmissionError extends Error {
  constructor(message) {
    super(message);
    this.status = 409;
    this.name = 'DuplicateSubmissionError';
  }
}

module.exports = {
  ValidationError,
  LimitExceededError,
  NotFoundError,
  DuplicateSubmissionError,
};