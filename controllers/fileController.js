const File = require('../models/File');
const { v4: uuidv4 } = require('uuid');
const AWS = require('aws-sdk');

// Configure AWS
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION
});

// S3 Health Check
exports.s3HealthCheck = async (req, res) => {
  try {
    const params = {
      Bucket: process.env.AWS_S3_BUCKET,
      MaxKeys: 1
    };
    
    await s3.listObjectsV2(params).promise();
    
    res.status(200).json({
      message: 'S3 connection successful',
      bucket: process.env.AWS_S3_BUCKET,
      region: process.env.AWS_REGION,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('S3 health check error:', err);
    res.status(500).json({
      message: 'S3 connection failed',
      error: err.message,
      bucket: process.env.AWS_S3_BUCKET,
      region: process.env.AWS_REGION
    });
  }
};

// Upload File to S3
exports.uploadFile = async (req, res) => {
  try {
    const { questionId } = req.validatedData;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ 
        error: 'No file uploaded',
        message: 'No file was received in the request'
      });
    }

    console.log('Processing uploaded file:', {
      fieldname: file.fieldname,
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      key: file.key,
      location: file.location,
      bucket: file.bucket
    });

    // Enhanced file type detection
    let fileType;
    if (file.mimetype.includes('pdf')) {
      fileType = 'pdf';
    } else if (file.mimetype.startsWith('image/')) {
      fileType = 'image';
    } else if (file.mimetype.includes('document') || file.mimetype.includes('word') || file.mimetype.includes('excel') || file.mimetype.includes('powerpoint')) {
      fileType = 'document';
    } else {
      fileType = 'other';
    }
    
    // Generate S3 URL - use location if available, otherwise construct it
    let fileUrl;
    if (file.location) {
      fileUrl = file.location;
    } else {
      fileUrl = `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${file.key}`;
    }

    const newFile = await File.create({
      fileId: uuidv4(),
      userId: req.user.userId,
      questionId: questionId || null,
      fileType,
      mimeType: file.mimetype, // Store actual MIME type
      fileName: file.key,
      fileUrl,
      fileSize: file.size,
      originalName: file.originalname,
      filePath: fileUrl // Keep for backward compatibility
    });

    console.log('File saved to database:', newFile);

    res.status(201).json({
      message: 'File uploaded successfully',
      file: newFile
    });
  } catch (err) {
    console.error('File upload error:', err);
    res.status(500).json({ 
      error: 'File upload failed',
      message: err.message 
    });
  }
};

// Get all files for a user
exports.getUserFiles = async (req, res) => {
  try {
    const files = await File.find({ userId: req.user.userId }).sort({ createdAt: -1 });
    res.status(200).json({
      message: 'Files retrieved successfully',
      files: files
    });
  } catch (err) {
    console.error('Get user files error:', err);
    res.status(500).json({ error: err.message });
  }
};

// Get files for a question
exports.getFilesByQuestion = async (req, res) => {
  try {
    const files = await File.find({ questionId: req.params.questionId, userId: req.user.userId });
    res.status(200).json({
      message: 'Question files retrieved successfully',
      files: files
    });
  } catch (err) {
    console.error('Get question files error:', err);
    res.status(500).json({ error: err.message });
  }
};

// Delete a file from S3 and database
exports.deleteFile = async (req, res) => {
  try {
    const file = await File.findOne({ fileId: req.params.fileId, userId: req.user.userId });

    if (!file) return res.status(404).json({ message: 'File not found' });

    // Delete from S3 if fileName exists
    if (file.fileName) {
      const params = {
        Bucket: process.env.AWS_S3_BUCKET,
        Key: file.fileName
      };

      try {
        await s3.deleteObject(params).promise();
        console.log(`File deleted from S3: ${file.fileName}`);
      } catch (s3Error) {
        console.error('S3 deletion error:', s3Error);
        // Continue with database deletion even if S3 deletion fails
      }
    }

    // Delete from database
    await File.findOneAndDelete({ fileId: req.params.fileId, userId: req.user.userId });

    res.status(200).json({ message: 'File deleted successfully' });
  } catch (err) {
    console.error('Delete file error:', err);
    res.status(500).json({ error: err.message });
  }
};

// Get file by ID
exports.getFileById = async (req, res) => {
  try {
    const file = await File.findOne({ fileId: req.params.fileId, userId: req.user.userId });
    
    if (!file) return res.status(404).json({ message: 'File not found' });

    res.status(200).json({
      message: 'File retrieved successfully',
      file: file
    });
  } catch (err) {
    console.error('Get file by ID error:', err);
    res.status(500).json({ error: err.message });
  }
};

// Generate pre-signed URL for file access
exports.getFileAccessUrl = async (req, res) => {
  try {
    const file = await File.findOne({ fileId: req.params.fileId, userId: req.user.userId });
    
    if (!file) {
      return res.status(404).json({ message: 'File not found' });
    }

    // Generate pre-signed URL that expires in 1 hour
    const params = {
      Bucket: process.env.AWS_S3_BUCKET,
      Key: file.fileName,
      Expires: 3600, // URL expires in 1 hour
      ResponseContentDisposition: `inline; filename="${file.originalName}"`,
      ResponseContentType: file.mimeType || 'application/octet-stream'
    };

    const signedUrl = await s3.getSignedUrlPromise('getObject', params);
    
    res.status(200).json({
      message: 'File access URL generated successfully',
      signedUrl: signedUrl,
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      fileInfo: {
        fileId: file.fileId,
        fileName: file.originalName,
        fileType: file.fileType,
        mimeType: file.mimeType,
        fileSize: file.fileSize
      }
    });
  } catch (err) {
    console.error('Generate file access URL error:', err);
    res.status(500).json({ error: err.message });
  }
};
