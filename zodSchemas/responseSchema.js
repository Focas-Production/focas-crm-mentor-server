const { z } = require("zod");

const responseSchema = z.object({
  sessionId: z.string().min(1, "Session ID is required"),
  questionId: z.string().min(1, "Question ID is required"),
  responseType: z.enum(["text", "audio"]),
  content: z.string().min(1, "Content is required"),
  isStepByStep: z.boolean().optional().default(false),
});

module.exports = { responseSchema };
