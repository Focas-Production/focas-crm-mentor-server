# File Access Implementation with Pre-signed URLs

## Overview

This implementation provides secure access to files stored in AWS S3 using pre-signed URLs. Instead of making files publicly accessible, the system generates temporary, secure URLs that expire after a set time period.

## Key Features

- ✅ **Secure File Access**: Files are not publicly accessible
- ✅ **Temporary URLs**: Pre-signed URLs expire after 1 hour
- ✅ **User Authentication**: Only authenticated users can access their files
- ✅ **Multiple File Types**: Supports images, PDFs, documents, and more
- ✅ **MIME Type Detection**: Automatically detects and stores file types

## Supported File Types

### Images
- JPEG (.jpg, .jpeg)
- PNG (.png)
- GIF (.gif)
- WebP (.webp)

### Documents
- PDF (.pdf)
- Microsoft Word (.doc, .docx)
- Microsoft Excel (.xls, .xlsx)
- Microsoft PowerPoint (.ppt, .pptx)
- Text files (.txt, .csv)

### Archives
- ZIP (.zip)
- RAR (.rar)

## API Endpoints

### 1. Get File Access URL
```
GET /api/files/:fileId/access
Authorization: Bearer <token>
```

**Response:**
```json
{
  "message": "File access URL generated successfully",
  "signedUrl": "https://bucket.s3.region.amazonaws.com/file?X-Amz-Algorithm=...",
  "expiresAt": "2025-08-27T21:39:10.778Z",
  "fileInfo": {
    "fileId": "48fa6e9b-3e19-46e9-9763-4b6c962725f3",
    "fileName": "1000000093.jpg",
    "fileType": "image",
    "mimeType": "image/jpeg",
    "fileSize": 98770
  }
}
```

### 2. Upload File
```
POST /api/files
Authorization: Bearer <token>
Content-Type: multipart/form-data

Body: file=<file>, questionId=<optional>
```

**Response:**
```json
{
  "message": "File uploaded successfully",
  "file": {
    "fileId": "48fa6e9b-3e19-46e9-9763-4b6c962725f3",
    "userId": "30bb8cfd-e982-4ab0-954b-e28777f74c4e",
    "questionId": "7c923eac-c091-4b0e-af77-1226219334ea",
    "fileType": "image",
    "mimeType": "image/jpeg",
    "fileName": "1756327150207-mrz6zwxnwjl.jpeg",
    "fileUrl": "https://bucket.s3.region.amazonaws.com/...",
    "fileSize": 98770,
    "originalName": "1000000093.jpg",
    "createdAt": "2025-08-27T20:39:10.778Z"
  }
}
```

### 3. Get User Files
```
GET /api/files
Authorization: Bearer <token>
```

### 4. Get File by ID
```
GET /api/files/:fileId
Authorization: Bearer <token>
```

## Frontend Implementation

### React/React Native Example

```javascript
import React, { useState, useEffect } from 'react';

const FileViewer = ({ file, token }) => {
  const [fileAccessUrl, setFileAccessUrl] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const getFileAccessUrl = async () => {
      try {
        setIsLoading(true);
        const response = await fetch(`/api/files/${file.fileId}/access`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        
        if (!response.ok) {
          throw new Error('Failed to get file access URL');
        }
        
        const data = await response.json();
        setFileAccessUrl(data.signedUrl);
        setError(null);
      } catch (err) {
        console.error('Error getting file access URL:', err);
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    };

    if (file && file.fileId) {
      getFileAccessUrl();
    }
  }, [file, token]);

  const renderFile = () => {
    if (isLoading) return <div>Loading file...</div>;
    if (error) return <div>Error: {error}</div>;
    if (!fileAccessUrl) return <div>No access URL available</div>;

    switch (file.fileType) {
      case 'image':
        return (
          <img 
            src={fileAccessUrl} 
            alt={file.originalName}
            style={{ maxWidth: '100%', height: 'auto' }}
          />
        );
      
      case 'pdf':
        return (
          <iframe 
            src={fileAccessUrl} 
            width="100%" 
            height="600px"
            title={file.originalName}
          />
        );
      
      case 'document':
        return (
          <div>
            <p>Document: {file.originalName}</p>
            <a 
              href={fileAccessUrl} 
              target="_blank" 
              rel="noopener noreferrer"
              className="btn btn-primary"
            >
              Download Document
            </a>
          </div>
        );
      
      default:
        return (
          <div>
            <p>File: {file.originalName}</p>
            <a 
              href={fileAccessUrl} 
              target="_blank" 
              rel="noopener noreferrer"
              className="btn btn-secondary"
            >
              Download File
            </a>
          </div>
        );
    }
  };

  return (
    <div className="file-viewer">
      <h3>{file.originalName}</h3>
      <div className="file-info">
        <p>Type: {file.fileType}</p>
        <p>Size: {(file.fileSize / 1024).toFixed(2)} KB</p>
        <p>Uploaded: {new Date(file.createdAt).toLocaleDateString()}</p>
      </div>
      <div className="file-content">
        {renderFile()}
      </div>
    </div>
  );
};

export default FileViewer;
```

### File List Component

```javascript
const FileList = ({ files, token }) => {
  const [filesWithAccess, setFilesWithAccess] = useState([]);

  useEffect(() => {
    const getAccessUrls = async () => {
      const filesWithUrls = await Promise.all(
        files.map(async (file) => {
          try {
            const response = await fetch(`/api/files/${file.fileId}/access`, {
              headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (response.ok) {
              const data = await response.json();
              return { ...file, accessUrl: data.signedUrl };
            }
            return file;
          } catch (error) {
            console.error(`Error getting access URL for ${file.fileId}:`, error);
            return file;
          }
        })
      );
      
      setFilesWithAccess(filesWithUrls);
    };

    if (files.length > 0) {
      getAccessUrls();
    }
  }, [files, token]);

  return (
    <div className="file-list">
      {filesWithAccess.map(file => (
        <div key={file.fileId} className="file-item">
          <h4>{file.originalName}</h4>
          <p>Type: {file.fileType}</p>
          {file.accessUrl && (
            <FileViewer file={file} token={token} />
          )}
        </div>
      ))}
    </div>
  );
};
```

## Security Features

### 1. **Private S3 Bucket**
- Files are stored with `acl: 'private'`
- No public read access
- Only accessible via pre-signed URLs

### 2. **User Authentication**
- All file access requires valid JWT token
- Users can only access their own files
- File ownership verification on every request

### 3. **Temporary Access**
- URLs expire after 1 hour
- New URLs must be generated for continued access
- Prevents unauthorized sharing of permanent links

### 4. **Content Type Validation**
- MIME type verification on upload
- Proper content disposition headers
- File type restrictions

## Environment Variables

Make sure these are set in your `.env` file:

```bash
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_REGION=ap-south-1
AWS_S3_BUCKET=ca-guru-app-file-storage
```

## Testing

Run the test script to verify S3 connectivity:

```bash
cd backend
node test-file-access.js
```

## Error Handling

### Common Issues

1. **Permission Denied**
   - Check AWS credentials
   - Verify bucket permissions
   - Ensure IAM user has S3 read access

2. **File Not Found**
   - Verify file exists in S3
   - Check file key in database
   - Ensure user owns the file

3. **URL Expired**
   - Generate new access URL
   - URLs expire after 1 hour
   - Implement automatic refresh if needed

## Performance Considerations

- **URL Caching**: Consider caching pre-signed URLs for frequently accessed files
- **Batch Operations**: Use `getUserFilesWithAccess` for multiple files
- **Lazy Loading**: Generate URLs only when needed
- **CDN Integration**: Consider CloudFront for global file distribution

## Future Enhancements

- [ ] **URL Refresh**: Automatic URL refresh before expiration
- [ ] **Thumbnail Generation**: Auto-generate image thumbnails
- [ ] **File Preview**: Generate previews for documents
- [ ] **Compression**: Automatic file compression for large files
- [ ] **Virus Scanning**: Integrate with AWS GuardDuty or similar
