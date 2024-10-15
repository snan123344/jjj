// index.js

// Load environment variables from .env file (if present)
require('dotenv').config();

// Import necessary modules
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const morgan = require('morgan');
const axios = require('axios');
const stream = require('stream');
const util = require('util');
const ffmpegPath = require('ffmpeg-static');
const ffmpeg = require('fluent-ffmpeg');

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

// Define maximum upload size (default to 500 MB if not set)
const MAX_UPLOAD_SIZE = process.env.MAX_UPLOAD_SIZE
    ? parseInt(process.env.MAX_UPLOAD_SIZE, 10)
    : 500 * 1024 * 1024; // 500 MB

console.log(`Maximum upload size is set to ${formatBytes(MAX_UPLOAD_SIZE)}`);

// Define uploads directory (absolute path)
const uploadDir = path.join(__dirname, 'uploads');

// Ensure uploads directory exists
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true, mode: 0o755 });
    console.log(`Created uploads directory at ${uploadDir}`);
}

// Configure FFmpeg with the static binary
ffmpeg.setFfmpegPath(ffmpegPath);

// === Middleware ===

// HTTP request logger
app.use(morgan('combined'));

// Parse JSON and URL-encoded data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve uploaded files as static files (excluding media files to handle Range requests)
app.use('/uploads', (req, res, next) => {
    const filename = path.basename(req.path);
    const mimeType = getMimeType(filename);
    if (mediaMimeTypes.includes(mimeType)) {
        // If it's a media file, handle streaming with Range support
        return next();
    }
    // For non-media files, serve statically using absolute path
    express.static(uploadDir)(req, res, next);
});

// === Multer Configuration ===

// Configure Multer storage for handling file uploads with original filenames
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir); // Files will be stored in the 'uploads' directory
    },
    filename: function (req, file, cb) {
        const originalName = file.originalname;
        // Sanitize the filename to prevent security issues
        const sanitizedFilename = sanitizeFilename(originalName);
        cb(null, sanitizedFilename);
    }
});

// Initialize Multer with storage, file size limits, and file type filtering
const upload = multer({
    storage: storage,
    limits: { fileSize: MAX_UPLOAD_SIZE },
    fileFilter: (req, file, cb) => {
        // Define allowed MIME types
        const allowedMimeTypes = [
            ...mediaMimeTypes,
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'text/plain',
            // Add more as needed
        ];

        if (allowedMimeTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'File type not supported!'));
        }
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

            <!-- Include hls.js -->
            <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
    
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
                            status.innerText = `Upload Progress: ${Math.round(percentComplete)}% - Speed: ${speed.toFixed(2)} KB/s`;
                        }
                    };

                    // Handle successful upload
                    xhr.onload = function() {
                        if (xhr.status === 200) {
                            const response = JSON.parse(xhr.responseText);
                            if (response.watchUrl) {
                                uploadedFile.innerHTML = `<a href="${response.watchUrl}" target="_blank">Watch Uploaded Video</a>`;
                            } else if (response.fileUrl) {
                                uploadedFile.innerHTML = `<a href="${response.fileUrl}" target="_blank">Download Uploaded File</a>`;
                            }

                            // Display File Metadata
                            fileMetadata.innerHTML = `
                                <h3>File Metadata:</h3>
                                <p><strong>Name:</strong> ${file.name}</p>
                                <p><strong>Size:</strong> ${formatBytes(file.size)}</p>
                                <p><strong>Type:</strong> ${file.type}</p>
                                <p><strong>Upload Time:</strong> ${new Date().toLocaleString()}</p>
                            `;

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
                            if (xhr.status === 200) {
                                const response = JSON.parse(xhr.responseText);
                                uploadedFile.innerHTML = `<a href="${response.watchUrl || response.fileUrl}" target="_blank">Access Uploaded File</a>`;

                                // Display File Metadata and Download Speed
                                fileMetadata.innerHTML = `
                                    <h3>File Metadata:</h3>
                                    <p><strong>Name:</strong> ${response.metadata.name}</p>
                                    <p><strong>Size:</strong> ${formatBytes(response.metadata.size)}</p>
                                    <p><strong>Type:</strong> ${response.metadata.type}</p>
                                    <p><strong>Download Time:</strong> ${response.downloadTime.toFixed(2)} seconds</p>
                                    <p><strong>Download Speed:</strong> ${response.downloadSpeed.toFixed(2)} KB/s</p>
                                    <p><strong>Upload Time:</strong> ${new Date().toLocaleString()}</p>
                                `;

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
app.post('/upload', upload.single('file'), async (req, res) => {
    if (!req.file) {
        console.log('No file uploaded.');
        return res.status(400).json({ error: 'No file uploaded.' });
    }

    const isMedia = mediaMimeTypes.includes(req.file.mimetype);
    const originalFilename = req.file.filename;
    const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${encodeURIComponent(originalFilename)}`;

    console.log(`File uploaded: ${originalFilename}`);
    console.log(`MIME Type: ${req.file.mimetype}`);
    console.log(`File Size: ${req.file.size} bytes`);
    console.log(`Is Media: ${isMedia}`);

    if (isMedia) {
        try {
            // Convert the uploaded video to HLS format
            const hlsOutputDir = path.join(uploadDir, path.parse(originalFilename).name);
            if (!fs.existsSync(hlsOutputDir)) {
                fs.mkdirSync(hlsOutputDir, { recursive: true, mode: 0o755 });
                console.log(`Created HLS output directory at ${hlsOutputDir}`);
            }

            // Define HLS quality levels
            const qualityLevels = [
                { name: '720p', size: '1280x720', bitrate: '2800k' },
                { name: '480p', size: '854x480', bitrate: '1400k' },
                { name: '360p', size: '640x360', bitrate: '800k' },
            ];

            // Generate stream inputs for each quality level
            const streams = qualityLevels.map(level => {
                return {
                    size: level.size,
                    bitrate: level.bitrate,
                };
            });

            // Run FFmpeg to create HLS streams
            await new Promise((resolve, reject) => {
                let ffmpegCommand = ffmpeg(req.file.path)
                    .addOptions([
                        '-profile:v baseline', // baseline profile (level 3.0) for H264 video codec
                        '-level 3.0',
                        '-s', '640x360', // initial resolution
                        '-start_number', '0',
                        '-hls_time', '10', // 10 second segments
                        '-hls_list_size', '0',
                        '-f', 'hls',
                    ]);

                // Add outputs for each quality level
                qualityLevels.forEach(level => {
                    ffmpegCommand = ffmpegCommand
                        .output(path.join(hlsOutputDir, `${level.name}.m3u8`))
                        .videoCodec('libx264')
                        .size(level.size)
                        .videoBitrate(level.bitrate)
                        .noAudio()
                        .outputOptions([
                            '-hls_segment_filename', path.join(hlsOutputDir, `${level.name}_%03d.ts`),
                        ]);
                });

                // Generate master playlist
                ffmpegCommand
                    .on('error', (err) => {
                        console.error('Error during HLS conversion:', err.message);
                        reject(err);
                    })
                    .on('end', () => {
                        console.log('HLS conversion completed successfully.');
                        resolve();
                    })
                    .run();
            });

            // Create a master playlist that references all quality levels
            const masterPlaylistPath = path.join(hlsOutputDir, 'master.m3u8');
            let masterPlaylist = '#EXTM3U\n#EXT-X-VERSION:3\n';

            qualityLevels.forEach(level => {
                masterPlaylist += `#EXT-X-STREAM-INF:BANDWIDTH=${parseInt(level.bitrate) * 1000},RESOLUTION=${level.size}\n${level.name}.m3u8\n`;
            });

            fs.writeFileSync(masterPlaylistPath, masterPlaylist);
            console.log(`Master playlist created at ${masterPlaylistPath}`);

            const watchUrl = `${req.protocol}://${req.get('host')}/watch/${encodeURIComponent(originalFilename)}`;
            res.json({ 
                message: 'Media file uploaded and converted to HLS successfully.',
                watchUrl: watchUrl
            });
        } catch (error) {
            console.error('Error during HLS conversion:', error.message);
            return res.status(500).json({ error: 'Error processing video for streaming.' });
        }
    } else {
        console.log(`File URL: ${fileUrl}`);
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
        console.log('No URL provided.');
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
        if (!filename || filename === '/') {
            // Fallback to a default filename if extraction fails
            const ext = getExtensionFromMime(response.headers['content-type']) || '';
            filename = 'downloaded-file' + ext;
        }

        const mimeType = response.headers['content-type'] || 'application/octet-stream';
        const size = parseInt(response.headers['content-length'], 10) || 0;

        const sanitizedFilename = sanitizeFilename(filename);
        const filePath = path.join(uploadDir, sanitizedFilename);

        console.log(`Downloading file from URL: ${fileUrl}`);
        console.log(`Saving as: ${sanitizedFilename}`);
        console.log(`MIME Type: ${mimeType}`);
        console.log(`File Size: ${size} bytes`);

        const writer = fs.createWriteStream(filePath);

        // Pipe the response data to the file
        response.data.pipe(writer);

        // Listen for the finish event to calculate download speed
        const finished = util.promisify(stream.finished);
        await finished(writer);

        const endTime = Date.now();
        const downloadTime = (endTime - startTime) / 1000; // in seconds
        const downloadSpeed = size / 1024 / downloadTime; // in KB/s

        console.log(`Download completed in ${downloadTime} seconds at ${downloadSpeed.toFixed(2)} KB/s`);

        const isMedia = mediaMimeTypes.includes(mimeType);
        let watchUrl = null;
        let fileDownloadUrl = null;

        if (isMedia) {
            // Convert the downloaded media file to HLS
            const hlsOutputDir = path.join(uploadDir, path.parse(sanitizedFilename).name);
            if (!fs.existsSync(hlsOutputDir)) {
                fs.mkdirSync(hlsOutputDir, { recursive: true, mode: 0o755 });
                console.log(`Created HLS output directory at ${hlsOutputDir}`);
            }

            // Define HLS quality levels
            const qualityLevels = [
                { name: '720p', size: '1280x720', bitrate: '2800k' },
                { name: '480p', size: '854x480', bitrate: '1400k' },
                { name: '360p', size: '640x360', bitrate: '800k' },
            ];

            // Run FFmpeg to create HLS streams
            await new Promise((resolve, reject) => {
                let ffmpegCommand = ffmpeg(filePath)
                    .addOptions([
                        '-profile:v baseline', // baseline profile (level 3.0) for H264 video codec
                        '-level 3.0',
                        '-start_number', '0',
                        '-hls_time', '10', // 10 second segments
                        '-hls_list_size', '0',
                        '-f', 'hls',
                    ]);

                // Add outputs for each quality level
                qualityLevels.forEach(level => {
                    ffmpegCommand = ffmpegCommand
                        .output(path.join(hlsOutputDir, `${level.name}.m3u8`))
                        .videoCodec('libx264')
                        .size(level.size)
                        .videoBitrate(level.bitrate)
                        .noAudio()
                        .outputOptions([
                            '-hls_segment_filename', path.join(hlsOutputDir, `${level.name}_%03d.ts`),
                        ]);
                });

                // Generate master playlist
                ffmpegCommand
                    .on('error', (err) => {
                        console.error('Error during HLS conversion:', err.message);
                        reject(err);
                    })
                    .on('end', () => {
                        console.log('HLS conversion completed successfully.');
                        resolve();
                    })
                    .run();
            });

            // Create a master playlist that references all quality levels
            const masterPlaylistPath = path.join(hlsOutputDir, 'master.m3u8');
            let masterPlaylist = '#EXTM3U\n#EXT-X-VERSION:3\n';

            qualityLevels.forEach(level => {
                masterPlaylist += `#EXT-X-STREAM-INF:BANDWIDTH=${parseInt(level.bitrate) * 1000},RESOLUTION=${level.size}\n${level.name}.m3u8\n`;
            });

            fs.writeFileSync(masterPlaylistPath, masterPlaylist);
            console.log(`Master playlist created at ${masterPlaylistPath}`);

            watchUrl = `${req.protocol}://${req.get('host')}/watch/${encodeURIComponent(sanitizedFilename)}`;
        } else {
            fileDownloadUrl = `${req.protocol}://${req.get('host')}/uploads/${encodeURIComponent(sanitizedFilename)}`;
        }

        // Gather file metadata
        const metadata = {
            name: sanitizedFilename,
            size: size,
            type: mimeType,
            uploadTime: new Date().toLocaleString(),
        };

        res.json({
            message: isMedia ? 'Media file downloaded and converted to HLS successfully via URL.' : 'File downloaded successfully via URL.',
            watchUrl: watchUrl,
            fileUrl: fileDownloadUrl,
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
    const filePath = path.join(uploadDir, filename);

    console.log(`Attempting to watch file: ${filePath}`);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
        console.log(`File not found: ${filePath}`);
        return res.status(404).send('File not found.');
    }

    // Determine MIME type
    const mimeType = getMimeType(filename);
    if (!mediaMimeTypes.includes(mimeType)) {
        console.log(`Unsupported media type: ${mimeType}`);
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

    // Define HLS output directory
    const hlsOutputDir = path.join(uploadDir, path.parse(filename).name);
    const masterPlaylistPath = path.join(hlsOutputDir, 'master.m3u8');

    // Check if HLS master playlist exists
    if (!fs.existsSync(masterPlaylistPath)) {
        console.log(`Master playlist not found for file: ${filename}`);
        return res.status(404).send('Streaming not available for this file.');
    }

    console.log(`Serving watch page for file: ${filename}`);

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
                    <source src="/uploads/${encodeURIComponent(filename)}/master.m3u8" type="application/x-mpegURL">
                    Your browser does not support the video tag.
                </video>
            </div>
            <div class="controls">
                <a href="/">Upload Another File</a>
                <a href="/uploads/${encodeURIComponent(filename)}/master.m3u8" download>Download Video</a>
            </div>
            <div class="metadata">
                <h3>File Metadata:</h3>
                <p><strong>Name:</strong> ${metadata.name}</p>
                <p><strong>Size:</strong> ${formatBytes(metadata.size)}</p>
                <p><strong>Type:</strong> ${metadata.type}</p>
                <p><strong>Upload Time:</strong> ${metadata.uploadTime}</p>
            </div>

            <!-- Include hls.js -->
            <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>

            <script src="https://cdn.plyr.io/3.7.2/plyr.polyfilled.js"></script>
            <script>
                const video = document.getElementById('player');
                const source = video.querySelector('source');

                if (Hls.isSupported()) {
                    const hls = new Hls();
                    hls.loadSource(source.src);
                    hls.attachMedia(video);
                    hls.on(Hls.Events.MANIFEST_PARSED, function() {
                        video.play();
                    });
                }
                // Hls.js is not supported on platforms that do not have Media Source Extensions (MSE) enabled.
                // For example, IE11 or Safari on older versions.
                else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                    video.src = source.src;
                    video.addEventListener('loadedmetadata', function() {
                        video.play();
                    });
                }
            </script>
        </body>
        </html>
    `);
});

// Serve media files with support for HTTP Range Requests (streaming)
app.get('/uploads/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(uploadDir, filename);

    console.log(`Download request for file: ${filePath}`);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
        console.log(`File not found: ${filePath}`);
        return res.status(404).send('File not found.');
    }

    const mimeType = getMimeType(filename);
    if (!mediaMimeTypes.includes(mimeType)) {
        console.log(`Unsupported media type for download: ${mimeType}`);
        return res.status(400).send('File is not a supported media type.');
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

        console.log(`Range requested: ${start}-${end}`);

        if (start >= fileSize) {
            console.log(`Range start exceeds file size.`);
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

        console.log(`Sending partial content: 206`);
        res.writeHead(206, head);
        file.pipe(res);
    } else {
        const head = {
            'Content-Length': fileSize,
            'Content-Type': mimeType,
        };
        console.log(`Sending full content: 200`);
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
        '.m3u8': 'application/x-mpegURL',
        '.ts': 'video/MP2T',
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
        'application/x-mpegURL': '.m3u8',
        'video/MP2T': '.ts',
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

// Function to sanitize filenames (optional but recommended)
function sanitizeFilename(filename) {
    return filename.replace(/[^a-zA-Z0-9.\-_]/g, '_');
}

// === Error Handling Middleware ===

// Handle all other errors
app.use((err, req, res, next) => {
    console.error(err.stack); // Log error stack for debugging

    if (err instanceof multer.MulterError) {
        // Handle Multer-specific errors
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ error: `File is too large. Maximum size is ${formatBytes(MAX_UPLOAD_SIZE)}.` });
        } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
            return res.status(400).json({ error: 'File type not supported!' });
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
