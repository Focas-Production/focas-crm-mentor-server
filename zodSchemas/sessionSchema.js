const { z } = require("zod");

const sessionCreateSchema = z.object({
  sessionTitle: z.string().min(1, "Session title cannot be empty").optional(),
});

const sessionUpdateSchema = z.object({
  sessionTitle: z.string().min(1, "Session title cannot be empty").optional(),
  isCompleted: z.boolean().optional(),
});

module.exports = { sessionCreateSchema, sessionUpdateSchema };
