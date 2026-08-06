const { z } = require("zod");

const fileSchema = z.object({
  questionId: z.string().optional().nullable(), // may be null if not linked to a question
  // fileType, filePath, userId will be set by multer and middleware
});

module.exports = { fileSchema };
