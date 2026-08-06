
const { ZodError } = require("zod");
const zodErrorParser = require("../utils/zodErrorParser");

const errorHandler = (err, req, res, next) => {
  if (err instanceof ZodError) {
    return res.status(400).json({
      status: "fail",
      errors: zodErrorParser(err),
    });
  }

  // Default server error
  return res.status(err.statusCode || 500).json({
    status: "error",
    message: err.message || "Internal Server Error",
  });
};

module.exports = errorHandler;


