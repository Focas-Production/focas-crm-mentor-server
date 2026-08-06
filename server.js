require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const sessionRoutes = require("./routes/sessionRoutes");
const questionRoutes = require("./routes/questionRoutes");
const responseRoutes = require("./routes/responseRoutes");
const fileRoutes = require("./routes/fileRoutes");
const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const profileRoutes = require("./routes/profileRoutes");
const adminRoutes = require("./routes/adminRoutes");
const paymentRoutes = require("./routes/payment");
const mcqRoutes = require('./routes/mcqRoutes');
const webhookRoutes = require("./routes/webhookRoutes");
const cors = require("cors");

const app = express();
// Keep the raw body for webhook HMAC verification (wacrm signatures)
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(cors());

// Optional: Connect Mongo if ready
mongoose
  .connect(process.env.MONGO_URI, {
    maxPoolSize: 10, // Maximum number of connections in the pool
    minPoolSize: 2, // Minimum number of connections in the pool
    maxIdleTimeMS: 30000, // Close connections after 30 seconds of inactivity
    serverSelectionTimeoutMS: 30000, // Timeout for server selection
    socketTimeoutMS: 45000, // Socket timeout
    connectTimeoutMS: 30000, // Connection timeout
    bufferCommands: false, // Disable mongoose buffering
  })
  .then(() => console.log("Successfully connected to MongoDB."))
  .catch((err) => {
    console.error("Database connection error:", err);
    process.exit(1);
  });

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n⚠️ SIGINT received. Closing MongoDB connection...");
  await mongoose.connection.close();
  console.log("MongoDB connection closed.");
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n⚠️ SIGTERM received. Closing MongoDB connection...");
  await mongoose.connection.close();
  console.log("MongoDB connection closed.");
  process.exit(0);
});

app.get("/", (req, res) => {
  res.send("Mentor API is running...");
});

app.get("/test", (req, res) => {
  res.json({ status: "ok", message: "Test route responding 15/05/26" });
});

app.get("/testing", (req, res) => {
  res.json({ status: "ok", message: "Test route responding" });
});


app.use((req, res, next) => {
  // console.log("--- Incoming Request Body ---");
  // console.log(req.body);
  // console.log("---------------------------");
  next();
});

app.use("/api/admin", adminRoutes);
app.use("/api/sessions", sessionRoutes);
app.use("/api/questions", questionRoutes);
app.use("/api/responses", responseRoutes);
app.use("/api/files", fileRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/payment", paymentRoutes);
app.use('/api/mcq', mcqRoutes);
app.use("/api/data",webhookRoutes)
// Files are now served from S3, no need for static serving

const PORT = process.env.PORT || 7001;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Mentor Server running on port ${PORT}`);
  console.log("File storage: AWS S3");
  console.log(`S3 Bucket: ${process.env.AWS_S3_BUCKET}`);
  console.log(`AWS Region: ${process.env.AWS_REGION}`);
});
