const express = require("express");
const router = express.Router();

const { webhookHandler, healthCheck } = require("../controllers/watiWebhookController");
const { wacrmWebhookHandler } = require("../controllers/wacrmWebhookController");

router.post("/webhook", webhookHandler);
router.post("/wacrm-webhook", wacrmWebhookHandler);
router.get("/health", healthCheck);

router.get("/", (req, res) => {
  res.status(200).json({
    name: "WATI MCQ Bot",
    version: "1.0.0",
    status: "running",
    endpoints: {
      webhook: "POST /webhook",
      health: "GET /health",
    },
  });
});

router.use((req, res) => {
  res.status(404).json({
    error: "Not Found",
    message: `Route ${req.method} ${req.path} not found`,
  });
});

module.exports = router;