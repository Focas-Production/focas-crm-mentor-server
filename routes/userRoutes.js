// backend/routes/userRoutes.js
const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { protect } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const { updateUserSchema } = require('../zodSchemas/userSchema')

router.put('/profile', protect,validate(updateUserSchema), userController.updateUserProfile);
router.get('/query-usage', protect, userController.getQueryUsage);

module.exports = router;