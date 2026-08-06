const { z } = require("zod");

const questionSchema = z.object({
  sessionId: z.string().min(1, "Session ID is required"),
  questionType: z.enum(["numerical", "theoretical"]),
  inputType: z.enum(["text", "voice", "image", "pdf"]),
  content: z.string().optional().default(""),
  fileId: z.string().optional().nullable(),
  topic: z.string().min(1, "Topic is required"),
});

module.exports = { questionSchema };
