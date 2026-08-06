const multer = require('multer');
const multerS3 = require('multer-s3');
const AWS = require('aws-sdk');

// Configure AWS
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION
});

// Configure Multer with S3
const upload = multer({
  storage: multerS3({
    s3: s3,
    bucket: process.env.AWS_S3_BUCKET,
    acl: 'private', // Set access control
    metadata: function (req, file, cb) {
      console.log('Setting metadata for file:', file.originalname);
      cb(null, { 
        fieldName: file.fieldname,
        originalName: file.originalname,
        contentType: file.mimetype
      });
    },
    key: function (req, file, cb) {
      const ext = file.mimetype.split('/')[1];
      const timestamp = Date.now();
      const randomString = Math.random().toString(36).substring(2, 15);
      const filename = `${timestamp}-${randomString}.${ext}`;
      console.log('Generated filename:', filename);
      cb(null, filename);
    }
  }),
  fileFilter: (req, file, cb) => {
    console.log('File filter - Processing file:', {
      fieldname: file.fieldname,
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size
    });
    
    // Expanded allowed file types
    const allowedTypes = [
      // Images
      'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
      // Documents
      'application/pdf',
      'application/msword', // .doc
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
      'application/vnd.ms-excel', // .xls
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-powerpoint', // .ppt
      'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
      // Text files
      'text/plain', 'text/csv',
      // Archives
      'application/zip', 'application/x-rar-compressed'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      console.log('File type accepted:', file.mimetype);
      cb(null, true);
    } else {
      console.log('File type rejected:', file.mimetype);
      cb(new Error(`Invalid file type: ${file.mimetype}. Only PDF, images, documents, and common file types are allowed.`), false);
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Enhanced error handling wrapper
const handleFileUpload = (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      console.error('Multer error:', err);
      
      switch (err.code) {
        case 'LIMIT_FILE_SIZE':
          return res.status(400).json({
            error: 'File too large',
            message: 'File size must be less than 10MB'
          });
        case 'LIMIT_FILE_COUNT':
          return res.status(400).json({
            error: 'Too many files',
            message: 'Only one file can be uploaded at a time'
          });
        case 'LIMIT_FIELD_KEY':
          return res.status(400).json({
            error: 'Field name too long',
            message: 'Field name is too long'
          });
        case 'LIMIT_FIELD_VALUE':
          return res.status(400).json({
            error: 'Field value too long',
            message: 'Field value is too long'
          });
        case 'LIMIT_FIELD_COUNT':
          return res.status(400).json({
            error: 'Too many fields',
            message: 'Too many fields in form'
          });
        case 'LIMIT_UNEXPECTED_FILE':
          return res.status(400).json({
            error: 'Unexpected file',
            message: 'Unexpected file field'
          });
        default:
          return res.status(400).json({
            error: 'File upload error',
            message: err.message
          });
      }
    } else if (err) {
      console.error('File upload error:', err);
      return res.status(400).json({
        error: 'File upload failed',
        message: err.message
      });
    }
    
    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({
        error: 'No file uploaded',
        message: 'Please select a file to upload. The file field name must be "file".'
      });
    }
    
    console.log('File uploaded successfully:', {
      fieldname: req.file.fieldname,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      key: req.file.key,
      location: req.file.location
    });
    
    next();
  });
};

module.exports = { upload, handleFileUpload };
