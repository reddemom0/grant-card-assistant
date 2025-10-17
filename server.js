import express from 'express';
import cors from 'cors';
import agentHandler from './api/agent-sdk-handler.js';
import filesHandler from './api/files-handler.js';
import pdfHandler from './api/pdf-handler.js';
import { config } from 'dotenv';

config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '32mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: 'railway'
  });
});

// Agent SDK endpoint
app.post('/api/agent', agentHandler);

// Files API endpoints
app.post('/api/files', filesHandler.uploadMiddleware, filesHandler.uploadFiles);
app.get('/api/files', filesHandler.listFiles);
app.get('/api/files/:fileId', filesHandler.getFileMetadata);
app.get('/api/files/:fileId/download', filesHandler.downloadFile);
app.delete('/api/files/:fileId', filesHandler.deleteFile);

// PDF Processing endpoints (direct Messages API)
app.post('/api/pdf/process', pdfHandler.uploadMiddleware, pdfHandler.processPDF);
app.post('/api/pdf/upload-and-process', pdfHandler.uploadMiddleware, pdfHandler.uploadAndProcess);
app.post('/api/pdf/batch', pdfHandler.createBatch);
app.get('/api/pdf/batch/:batchId', pdfHandler.getBatchStatus);
app.get('/api/pdf/batch/:batchId/results', pdfHandler.getBatchResults);

// Serve static files (HTML pages)
app.use(express.static('.'));

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚂 Railway server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🤖 Agent endpoint: http://localhost:${PORT}/api/agent`);
  console.log(`📁 Files API: http://localhost:${PORT}/api/files`);
  console.log(`📄 PDF Processing: http://localhost:${PORT}/api/pdf`);
});
