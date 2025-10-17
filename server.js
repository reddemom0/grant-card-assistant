import express from 'express';
import cors from 'cors';
import agentHandler from './api/agent-sdk-handler.js';
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

// Serve static files (HTML pages)
app.use(express.static('.'));

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚂 Railway server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🤖 Agent endpoint: http://localhost:${PORT}/api/agent`);
});
