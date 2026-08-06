const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const FileSchema = new Schema({
  fileId: { type: String, required: true, unique: true, index: true },
  userId: { type: String, required: true, ref: 'User' },
  questionId: { type: String, ref: 'Question', default: null },
  fileType: { type: String, enum: ['image', 'pdf', 'document', 'other'], required: true },
  mimeType: { type: String, required: false }, // Store actual MIME type for better handling
  filePath: { type: String, required: false }, // Keep for backward compatibility
  fileName: { type: String, required: false }, // S3 key
  fileUrl: { type: String, required: false }, // S3 URL
  fileSize: { type: Number, required: false }, // File size in bytes
  originalName: { type: String, required: false }, // Original filename
  createdAt: { type: Date, default: Date.now }
});

FileSchema.index({ userId: 1 });
FileSchema.index({ questionId: 1, userId: 1 });

module.exports = mongoose.model('File', FileSchema);
