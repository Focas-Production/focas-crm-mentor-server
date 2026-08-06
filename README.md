# Mentor API Backend with AWS S3 File Storage

This backend API provides file storage capabilities using AWS S3 instead of local storage for better scalability and reliability.

## Features

- **File Upload**: Support for PDF and image files (JPEG, PNG)
- **AWS S3 Integration**: Files are stored in S3 buckets
- **User Authentication**: JWT-based authentication required for file operations
- **File Management**: Upload, retrieve, and delete files
- **Question Association**: Files can be linked to specific questions

## Environment Setup

1. Copy `env.example` to `.env`
2. Fill in your AWS credentials:
   ```
   AWS_ACCESS_KEY_ID=your_access_key
   AWS_SECRET_ACCESS_KEY=your_secret_key
   AWS_REGION=your_region
   AWS_S3_BUCKET=your_bucket_name
   ```

## Installation

```bash
npm install
```

## Running the Server

```bash
# Development
npm run dev

# Production
npm start
```

## API Endpoints

### File Management

#### 1. S3 Health Check
- **GET** `/api/files/health/s3`
- **Description**: Test S3 connectivity
- **Auth**: Not required
- **Response**: S3 connection status

#### 2. Upload File
- **POST** `/api/files`
- **Description**: Upload a file to S3
- **Auth**: Required (JWT token)
- **Body**: Form-data with `file` field and optional `questionId`
- **Response**: File details with S3 URL

#### 3. Get User Files
- **GET** `/api/files`
- **Description**: Get all files for authenticated user
- **Auth**: Required (JWT token)
- **Response**: Array of user's files

#### 4. Get Files by Question
- **GET** `/api/files/question/:questionId`
- **Description**: Get files associated with a specific question
- **Auth**: Required (JWT token)
- **Response**: Array of question files

#### 5. Get File by ID
- **GET** `/api/files/:fileId`
- **Description**: Get specific file details
- **Auth**: Required (JWT token)
- **Response**: File details

#### 6. Delete File
- **DELETE** `/api/files/:fileId`
- **Description**: Delete file from S3 and database
- **Auth**: Required (JWT token)
- **Response**: Success message

## Testing with Postman

### 1. Test S3 Connection
```
GET http://localhost:3000/api/files/health/s3
```
This should return S3 connection status.

### 2. Upload File
```
POST http://localhost:3000/api/files
Headers:
  Authorization: Bearer YOUR_JWT_TOKEN
  Content-Type: multipart/form-data

Body (form-data):
  file: [select your file]
  questionId: [optional question ID]
```

### 3. Get Files
```
GET http://localhost:3000/api/files
Headers:
  Authorization: Bearer YOUR_JWT_TOKEN
```

## File Storage Details

- **Storage**: AWS S3
- **File Types**: PDF, JPEG, PNG
- **Size Limit**: 10MB per file
- **Naming**: Timestamp + random string + extension
- **URL Format**: `https://bucket-name.s3.region.amazonaws.com/filename`

## Error Handling

- File type validation
- File size limits
- S3 connection errors
- Authentication errors
- Database errors

## Security Features

- JWT authentication required for file operations
- User can only access their own files
- File type validation
- Secure file naming (no original filename exposure)

## Troubleshooting

### Common Issues:

1. **S3 Connection Failed**
   - Check AWS credentials in `.env`
   - Verify bucket name and region
   - Ensure IAM user has S3 permissions

2. **File Upload Fails**
   - Check file type (PDF, JPEG, PNG only)
   - Ensure file size < 10MB
   - Verify JWT token is valid

3. **CORS Issues**
   - Configure CORS in your S3 bucket
   - Check frontend origin settings

## Dependencies

- `aws-sdk`: AWS SDK for JavaScript
- `multer-s3`: Multer storage engine for S3
- `multer`: File upload middleware
- `mongoose`: MongoDB ODM
- `express`: Web framework
- `jsonwebtoken`: JWT authentication