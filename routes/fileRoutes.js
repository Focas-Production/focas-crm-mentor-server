const express = require('express');
const router = express.Router();
const fileController = require('../controllers/fileController');
const { handleFileUpload } = require('../middleware/fileUpload');
const { protect } = require('../middleware/authMiddleware');
const { fileSchema } = require("../zodSchemas/fileSchema");
const validate = require("../middleware/validate")

// S3 Health Check (no auth required for testing)
router.get('/health/s3', fileController.s3HealthCheck);

router.post('/', protect, handleFileUpload, validate(fileSchema), fileController.uploadFile);
router.get('/', protect, fileController.getUserFiles);
router.get('/question/:questionId', protect, fileController.getFilesByQuestion);
router.get('/:fileId', protect, fileController.getFileById);
router.get('/:fileId/access', protect, fileController.getFileAccessUrl); // New route for pre-signed URLs
router.delete('/:fileId', protect, fileController.deleteFile);

module.exports = router;
