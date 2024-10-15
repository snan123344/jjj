// index.js

// Load environment variables from .env file
require('dotenv').config();

// Import necessary modules
const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const morgan = require('morgan');
const axios = require('axios');
const stream = require('stream');
const util = require('util');

const app = express();

// === Configuration ===

// Define allowed media MIME types for streaming
const mediaMimeTypes = [
    'video/mp4',
    'video/mkv',
    'video/webm',
    'video/avi',
    'video/quicktime',
    // Add more MIME types as needed
];

// Define maximum upload size (e.g., 500 MB)
const MAX_UPLOAD_SIZE = 500 * 1024 * 1024; // 500 MB

// Create uploads directory if it doesn't exist
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

// === Middleware ===

// HTTP request logger
app.use(morgan('combined'));

// Parse JSON and URL-encoded data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve uploaded files as static files (excluding media files to handle Range requests)
app.use('/uploads', (req, res, next) => {
    const filename = req.path.split('/').pop();
    const mimeType = getMimeType(filename);
    if (mediaMimeTypes.includes(mimeType)) {
        // If it's a media file, handle streaming with Range support
        return next();
    }
    // For non-media files, serve statically
    express.static(uploadDir)(req, res, next);
});

// === Multer Configuration ===

// Configure Multer storage for handling file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/'); // Files will be stored in the 'uploads' directory
    },
    filename: function (req, file, cb) {
        const ext = path.extname(file.originalname); // Get file extension
        cb(null, uuidv4() + ext); // Generate a unique filename using UUID
    }
});

// Initialize Multer with storage, file size limits, and file type filtering
const upload = multer({
    storage: storage,
    limits: { fileSize: MAX_UPLOAD_SIZE },
    fileFilter: (req, file, cb) => {
        // Allow all file types initially; validation handled post-upload or in specific routes
        cb(null, true);
    }
});

// === Routes ===

// Root route serving the upload form with options for File Upload and URL Upload
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <title>File & URL Upload with Progress and Metadata</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    padding: 40px;
                    background-color: #f9f9f9;
                }
                h1 {
                    text-align: center;
                }
                .container {
                    max-width: 800px;
                    margin: 0 auto;
                    background: #fff;
                    padding: 20px;
                    box-shadow: 0 0 10px rgba(0,0,0,0.1);
                    border-radius: 8px;
                }
                form {
                    margin-bottom: 40px;
                }
                input[type="file"], input[type="url"] {
                    width: 100%;
                    padding: 10px;
                    margin-bottom: 10px;
                    border: 1px solid #ccc;
                    border-radius: 4px;
                }
                button {
                    padding: 10px 20px;
                    background-color: #1e90ff;
                    color: #fff;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                }
                button:hover {
                    background-color: #3742fa;
                }
                #progressContainer {
                    margin-top: 20px;
                    width: 100%;
                }
                #progressBar {
                    width: 100%;
                    height: 20px;
                    appearance: none;
                    -webkit-appearance: none;
                    border-radius: 10px;
                    overflow: hidden;
                }
                #progressBar::-webkit-progress-bar {
                    background-color: #eee;
                }
                #progressBar::-webkit-progress-value {
                    background-color: #76c7c0;
                }
                #progressBar::-moz-progress-bar {
                    background-color: #76c7c0;
                }
                #status {
                    margin-top: 10px;
                }
                #uploadedFile a {
                    color: #1e90ff;
                    text-decoration: none;
                }
                #uploadedFile a:hover {
                    text-decoration: underline;
                }
                .metadata {
                    margin-top: 20px;
                    background-color: #f1f1f1;
                    padding: 10px;
                    border-radius: 4px;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>File & URL Upload</h1>
                
                <!-- File Upload Form -->
                <form id="fileUploadForm">
                    <h2>Upload a File</h2>
                    <input type="file" name="file" id="fileInput" required /><br />
                    <button type="submit">Upload File</button>
                </form>
                
                <!-- URL Upload Form -->
                <form id="urlUploadForm">
                    <h2>Upload via URL</h2>
                    <input type="url" name="fileUrl" id="fileUrlInput" placeholder="Enter file URL here" required /><br />
                    <button type="submit">Upload via URL</button>
                </form>
                
                <!-- Progress Bar and Status -->
                <div id="progressContainer">
                    <progress id="progressBar" value="0" max="100"></progress>
                    <div id="status"></div>
                </div>
                
                <!-- Uploaded File Link and Metadata -->
                <div id="uploadedFile"></div>
                <div class="metadata" id="fileMetadata"></div>
            </div>
    
            <script>
                // Helper function to format bytes to human-readable form
                function formatBytes(bytes) {
                    if (bytes === 0) return '0 Bytes';
                    const k = 1024;
                    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
                    const i = Math.floor(Math.log(bytes) / Math.log(k));
                    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
                }
    
                // File Upload Handling
                const fileUploadForm = document.getElementById('fileUploadForm');
                const fileInput = document.getElementById('fileInput');
                const progressBar = document.getElementById('progressBar');
                const status = document.getElementById('status');
                const uploadedFile = document.getElementById('uploadedFile');
                const fileMetadata = document.getElementById('fileMetadata');
    
                fileUploadForm.addEventListener('submit', function(event) {
                    event.preventDefault(); // Prevent default form submission
    
                    const file = fileInput.files[0];
                    if (!file) {
                        alert('Please select a file to upload.');
                        return;
                    }
    
                    const formData = new FormData();
                    formData.append('file', file);
    
                    const xhr = new XMLHttpRequest();
                    xhr.open('POST', '/upload', true);
    
                    const startTime = Date.now();
    
                    // Update progress bar and calculate upload speed
                    xhr.upload.onprogress = function(event) {
                        if (event.lengthComputable) {
                            const percentComplete = (event.loaded / event.total) * 100;
                            progressBar.value = percentComplete;
                            const elapsedTime = (Date.now() - startTime) / 1000; // in seconds
                            const speed = (event.loaded / elapsedTime) / 1024; // in KB/s
                            status.innerText = \`Upload Progress: \${Math.round(percentComplete)}% - Speed: \${speed.toFixed(2)} KB/s\`;
                        }
                    };
    
                    // Handle successful upload
                    xhr.onload = function() {
                        if (xhr.status === 200) {
                            const response = JSON.parse(xhr.responseText);
                            if (response.watchUrl) {
                                uploadedFile.innerHTML = \`<a href="\${response.watchUrl}" target="_blank">Watch Uploaded Video</a>\`;
                            } else if (response.fileUrl) {
                                uploadedFile.innerHTML = \`<a href="\${response.fileUrl}" target="_blank">Download Uploaded File</a>\`;
                            }
    
                            // Display File Metadata
                            fileMetadata.innerHTML = \`
                                <h3>File Metadata:</h3>
                                <p><strong>Name:</strong> \${file.name}</p>
                                <p><strong>Size:</strong> \${formatBytes(file.size)}</p>
                                <p><strong>Type:</strong> \${file.type}</p>
                                <p><strong>Upload Time:</strong> \${new Date().toLocaleString()}</p>
                            \`;
    
                            progressBar.value = 0; // Reset progress bar
                            status.innerText = 'Upload completed successfully.';
                        } else {
                            let errorMsg = 'Upload failed. Please try again.';
                            try {
                                const errorResponse = JSON.parse(xhr.responseText);
                                if (errorResponse.error) {
                                    errorMsg = errorResponse.error;
                                }
                            } catch (e) {
                                // Ignore JSON parse errors
                            }
                            status.innerText = errorMsg;
                            progressBar.value = 0;
                        }
                    };
    
                    // Handle errors
                    xhr.onerror = function() {
                        status.innerText = 'Upload failed. Please try again.';
                        progressBar.value = 0;
                    };
    
                    xhr.send(formData); // Send the form data to the server
                });
    
                // URL Upload Handling
                const urlUploadForm = document.getElementById('urlUploadForm');
                const fileUrlInput = document.getElementById('fileUrlInput');
    
                urlUploadForm.addEventListener('submit', function(event) {
                    event.preventDefault(); // Prevent default form submission
    
                    const fileUrl = fileUrlInput.value.trim();
                    if (!fileUrl) {
                        alert('Please enter a valid URL.');
                        return;
                    }
    
                    const xhr = new XMLHttpRequest();
                    xhr.open('POST', '/upload-url', true);
                    xhr.setRequestHeader('Content-Type', 'application/json;charset=UTF-8');
    
                    const startTime = Date.now();
    
                    // Update progress bar based on response
                    xhr.upload.onprogress = function(event) {
                        // Not applicable for JSON POST; skip or implement if necessary
                    };
    
                    xhr.onreadystatechange = function() {
                        if (xhr.readyState === XMLHttpRequest.DONE) {
                            const elapsedTime = (Date.now() - startTime) / 1000; // in seconds
                            if (xhr.status === 200) {
                                const response = JSON.parse(xhr.responseText);
                                uploadedFile.innerHTML = \`<a href="\${response.watchUrl || response.fileUrl}" target="_blank">Access Uploaded File</a>\`;
    
                                // Display File Metadata and Download Speed
                                fileMetadata.innerHTML = \`
                                    <h3>File Metadata:</h3>
                                    <p><strong>Name:</strong> \${response.metadata.name}</p>
                                    <p><strong>Size:</strong> \${formatBytes(response.metadata.size)}</p>
                                    <p><strong>Type:</strong> \${response.metadata.type}</p>
                                    <p><strong>Download Time:</strong> \${response.downloadTime.toFixed(2)} seconds</p>
                                    <p><strong>Download Speed:</strong> \${response.downloadSpeed.toFixed(2)} KB/s</p>
                                    <p><strong>Upload Time:</strong> \${new Date().toLocaleString()}</p>
                                \`;
    
                                status.innerText = 'URL upload completed successfully.';
                            } else {
                                let errorMsg = 'URL upload failed. Please try again.';
                                try {
                                    const errorResponse = JSON.parse(xhr.responseText);
                                    if (errorResponse.error) {
                                        errorMsg = errorResponse.error;
                                    }
                                } catch (e) {
                                    // Ignore JSON parse errors
                                }
                                status.innerText = errorMsg;
                            }
                            progressBar.value = 0; // Reset progress bar
                        }
                    };
    
                    // Handle errors
                    xhr.onerror = function() {
                        status.innerText = 'URL upload failed. Please try again.';
                        progressBar.value = 0;
                    };
    
                    // Send the JSON payload
                    xhr.send(JSON.stringify({ fileUrl }));
    
                    // Update status immediately
                    status.innerText = 'Processing URL upload...';
                });
            </script>
        </body>
        </html>
    `);
});

// File upload endpoint
app.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded.' });
    }

    const isMedia = mediaMimeTypes.includes(req.file.mimetype);
    const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;

    if (isMedia) {
        const watchUrl = `${req.protocol}://${req.get('host')}/watch/${req.file.filename}`;
        res.json({ 
            message: 'Media file uploaded successfully.',
            watchUrl: watchUrl
        });
    } else {
        res.json({ 
            message: 'File uploaded successfully.',
            fileUrl: fileUrl
        });
    }
});

// URL upload endpoint
app.post('/upload-url', async (req, res) => {
    const { fileUrl } = req.body;

    if (!fileUrl) {
        return res.status(400).json({ error: 'No URL provided.' });
    }

    try {
        const startTime = Date.now();
        const response = await axios({
            method: 'get',
            url: fileUrl,
            responseType: 'stream',
        });

        // Extract filename from URL or response headers
        let filename = path.basename(new URL(fileUrl).pathname);
        if (!filename) {
            // Fallback to a unique filename if extraction fails
            const ext = getExtensionFromMime(response.headers['content-type']) || '';
            filename = uuidv4() + ext;
        }

        const mimeType = response.headers['content-type'] || 'application/octet-stream';
        const size = parseInt(response.headers['content-length'], 10) || 0;

        const uniqueFilename = uuidv4() + path.extname(filename);
        const filePath = path.join(uploadDir, uniqueFilename);

        const writer = fs.createWriteStream(filePath);

        // Pipe the response data to the file
        response.data.pipe(writer);

        // Listen for the finish event to calculate download speed
        const finished = util.promisify(stream.finished);
        await finished(writer);

        const endTime = Date.now();
        const downloadTime = (endTime - startTime) / 1000; // in seconds
        const downloadSpeed = size / 1024 / downloadTime; // in KB/s

        const isMedia = mediaMimeTypes.includes(mimeType);
        const accessUrl = isMedia 
            ? `${req.protocol}://${req.get('host')}/watch/${uniqueFilename}`
            : `${req.protocol}://${req.get('host')}/uploads/${uniqueFilename}`;

        // Gather file metadata
        const metadata = {
            name: filename,
            size: size,
            type: mimeType,
            uploadTime: new Date().toLocaleString(),
        };

        res.json({
            message: isMedia ? 'Media file uploaded successfully via URL.' : 'File uploaded successfully via URL.',
            watchUrl: isMedia ? accessUrl : null,
            fileUrl: isMedia ? null : accessUrl,
            downloadTime: downloadTime,
            downloadSpeed: downloadSpeed,
            metadata: metadata,
        });
    } catch (error) {
        console.error('Error downloading file from URL:', error.message);
        res.status(500).json({ error: 'Failed to download file from the provided URL.' });
    }
});

// Watch endpoint for media files
app.get('/watch/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(__dirname, 'uploads', filename);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
        return res.status(404).send('File not found.');
    }

    // Determine MIME type
    const mimeType = getMimeType(filename);
    if (!mediaMimeTypes.includes(mimeType)) {
        return res.status(400).send('File is not a supported media type.');
    }

    // Get file stats for metadata
    const stats = fs.statSync(filePath);
    const metadata = {
        name: filename,
        size: stats.size,
        type: mimeType,
        uploadTime: stats.birthtime.toLocaleString(),
    };

    // Serve the watch page with Plyr.io and Download Button
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <title>Watch Video</title>
            <link rel="stylesheet" href="https://cdn.plyr.io/3.7.2/plyr.css" />
            <style>
                body {
                    font-family: Arial, sans-serif;
                    padding: 20px;
                    background-color: #f4f4f4;
                }
                .player-wrapper {
                    max-width: 800px;
                    margin: 0 auto;
                }
                .controls {
                    text-align: center;
                    margin-top: 20px;
                }
                .controls a {
                    display: inline-block;
                    margin: 0 10px;
                    padding: 10px 20px;
                    background-color: #1e90ff;
                    color: #fff;
                    text-decoration: none;
                    border: none;
                    border-radius: 5px;
                    cursor: pointer;
                }
                .controls a:hover {
                    background-color: #3742fa;
                }
                .metadata {
                    max-width: 800px;
                    margin: 20px auto;
                    background-color: #fff;
                    padding: 20px;
                    border-radius: 8px;
                    box-shadow: 0 0 10px rgba(0,0,0,0.1);
                }
            </style>
        </head>
        <body>
            <div class="player-wrapper">
                <video id="player" controls crossorigin>
                    <source src="/uploads/${filename}" type="${mimeType}">
                    Your browser does not support the video tag.
                </video>
            </div>
            <div class="controls">
                <a href="/">Upload Another File</a>
                <a href="/uploads/${filename}" download>Download Video</a>
            </div>
            <div class="metadata">
                <h3>File Metadata:</h3>
                <p><strong>Name:</strong> ${metadata.name}</p>
                <p><strong>Size:</strong> ${formatBytes(metadata.size)}</p>
                <p><strong>Type:</strong> ${metadata.type}</p>
                <p><strong>Upload Time:</strong> ${metadata.uploadTime}</p>
            </div>
    
            <script src="https://cdn.plyr.io/3.7.2/plyr.polyfilled.js"></script>
            <script>
                const player = new Plyr('#player', {
                    autoplay: false,
                    controls: ['play', 'progress', 'current-time', 'mute', 'volume', 'fullscreen']
                });
            </script>
        </body>
        </html>
    `);
});

// Serve media files with support for HTTP Range Requests (streaming)
app.get('/uploads/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(__dirname, 'uploads', filename);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
        return res.status(404).send('File not found.');
    }

    const mimeType = getMimeType(filename);
    if (!mediaMimeTypes.includes(mimeType)) {
        return res.status(400).send('File is not a supported media type.');
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

        if (start >= fileSize) {
            res.status(416).send('Requested range not satisfiable\n' + start + ' >= ' + fileSize);
            return;
        }

        const chunksize = (end - start) + 1;
        const file = fs.createReadStream(filePath, { start, end });
        const head = {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunksize,
            'Content-Type': mimeType,
        };

        res.writeHead(206, head);
        file.pipe(res);
    } else {
        const head = {
            'Content-Length': fileSize,
            'Content-Type': mimeType,
        };
        res.writeHead(200, head);
        fs.createReadStream(filePath).pipe(res);
    }
});

// === Helper Functions ===

// Function to get MIME type based on file extension
function getMimeType(filename) {
    const ext = path.extname(filename).toLowerCase();
    const mimeTypes = {
        '.mp4': 'video/mp4',
        '.mkv': 'video/x-matroska',
        '.webm': 'video/webm',
        '.avi': 'video/x-msvideo',
        '.mov': 'video/quicktime',
        '.pdf': 'application/pdf',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.txt': 'text/plain',
        // Add more extensions and MIME types as needed
    };
    return mimeTypes[ext] || 'application/octet-stream';
}

// Function to get file extension from MIME type
function getExtensionFromMime(mimeType) {
    const mimeToExt = {
        'video/mp4': '.mp4',
        'video/x-matroska': '.mkv',
        'video/webm': '.webm',
        'video/x-msvideo': '.avi',
        'video/quicktime': '.mov',
        'application/pdf': '.pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
        'text/plain': '.txt',
        // Add more mappings as needed
    };
    return mimeToExt[mimeType] || '';
}

// Helper function to format bytes to human-readable form
function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// === Error Handling Middleware ===

// Handle all other errors
app.use((err, req, res, next) => {
    console.error(err.stack); // Log error stack for debugging

    if (err instanceof multer.MulterError) {
        // Handle Multer-specific errors
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ error: 'File is too large. Maximum size is 500MB.' });
        }
        return res.status(400).json({ error: err.message });
    } else if (err) {
        // Handle other errors
        return res.status(500).json({ error: err.message });
    }

    next();
});

// === Start the Server ===

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
