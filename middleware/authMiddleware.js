const jwt = require('jsonwebtoken');
const User = require('../models/User');
const JWT_SECRET = process.env.JWT_SECRET;

exports.protect = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "No token, access denied" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    // console.log(req.user);
    // console.log(token);
    next();
  } catch (err) {
    res.status(401).json({ message: "Invalid token" });
  }
};

exports.requireAdmin = async (req, res, next) => {
  try {
    const user = await User.findOne({ userId: req.user.userId });
    
    if (!user || !user.isAdmin) {
      return res.status(403).json({ message: 'Admin access required' });
    }
    
    next();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
