/**
 * PDF Processing Handler for Railway
 * Direct Messages API for PDF analysis (bypasses Agent SDK)
 */
import multer from 'multer';
import { pdfAPI, filesAPI } from '../src/anthropic-client.js';
import { formatCitations, getCitationSummary, getSourceDocuments } from '../src/citations-utils.js';

// Configure multer for PDF uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 32 * 1024 * 1024, // 32MB for PDFs
    files: 1, // Single PDF per request
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are supported'));
    }
  },
});

/**
 * Process a PDF document
 * POST /api/pdf/process
 *
 * Supports three methods:
 * 1. file_id - Reference uploaded file
 * 2. url - Reference PDF from URL
 * 3. file upload - Upload PDF directly
 */
export async function processPDF(req, res) {
  try {
    const {
      fileId,
      url,
      prompt,
      model,
      maxTokens,
      systemPrompt,
      enableCaching,
      enableCitations,
      documentTitle,
      documentContext
    } = req.body;

    if (!prompt) {
      return res.status(400).json({
        error: 'Missing required field: prompt'
      });
    }

    let base64Data = null;

    // Method 1: Use file_id from Files API
    if (fileId) {
      console.log(`📄 Processing PDF from file_id: ${fileId}`);
    }
    // Method 2: Use URL
    else if (url) {
      console.log(`📄 Processing PDF from URL: ${url}`);
    }
    // Method 3: Use uploaded file
    else if (req.file) {
      console.log(`📄 Processing uploaded PDF: ${req.file.originalname} (${(req.file.size / 1024).toFixed(2)} KB)`);
      base64Data = req.file.buffer;
    }
    else {
      return res.status(400).json({
        error: 'Must provide fileId, url, or upload a PDF file'
      });
    }

    // Process the PDF
    const result = await pdfAPI.process({
      fileId,
      url,
      base64Data,
      prompt,
      config: {
        model: model || 'claude-sonnet-4-5-20250929',
        maxTokens: maxTokens || 4096,
        systemPrompt,
        enableCaching: enableCaching || false,
        enableCitations: enableCitations || false,
        title: documentTitle,
        context: documentContext
      }
    });

    // Build response with citations if available
    const response = {
      success: true,
      text: result.text,
      usage: result.usage,
      model: result.model,
      messageId: result.messageId,
      caching: {
        enabled: enableCaching || false,
        cacheReadTokens: result.usage.cache_read_input_tokens || 0,
        cacheCreateTokens: result.usage.cache_creation_input_tokens || 0
      }
    };

    // Add citations if enabled
    if (result.citations && result.citations.length > 0) {
      response.citations = {
        raw: result.citations,
        summary: getCitationSummary(result.citations),
        sources: getSourceDocuments(result.citations),
        formatted: formatCitations(result.citations)
      };
    }

    res.json(response);

  } catch (error) {
    console.error('❌ PDF processing error:', error);
    res.status(500).json({
      error: 'PDF processing failed',
      message: error.message
    });
  }
}

/**
 * Upload and process a PDF in one request
 * POST /api/pdf/upload-and-process
 */
export async function uploadAndProcess(req, res) {
  try {
    const { prompt, enableCaching, enableCitations, documentTitle, documentContext } = req.body;

    if (!req.file) {
      return res.status(400).json({
        error: 'No PDF file provided'
      });
    }

    if (!prompt) {
      return res.status(400).json({
        error: 'Missing required field: prompt'
      });
    }

    console.log(`📤 Uploading PDF: ${req.file.originalname}`);

    // Upload to Files API first
    const uploadedFile = await filesAPI.upload(
      null,
      req.file.originalname,
      'application/pdf',
      req.file.buffer
    );

    console.log(`✅ Uploaded to Files API: ${uploadedFile.id}`);

    // Process using file_id
    const result = await pdfAPI.process({
      fileId: uploadedFile.id,
      prompt,
      config: {
        enableCaching: enableCaching || false
      }
    });

    res.json({
      success: true,
      fileId: uploadedFile.id,
      filename: uploadedFile.filename,
      sizeBytes: uploadedFile.size_bytes,
      text: result.text,
      usage: result.usage,
      model: result.model,
      messageId: result.messageId
    });

  } catch (error) {
    console.error('❌ Upload and process error:', error);
    res.status(500).json({
      error: 'Upload and process failed',
      message: error.message
    });
  }
}

/**
 * Create a PDF batch processing job
 * POST /api/pdf/batch
 */
export async function createBatch(req, res) {
  try {
    const { requests } = req.body;

    if (!requests || !Array.isArray(requests) || requests.length === 0) {
      return res.status(400).json({
        error: 'Missing or invalid requests array'
      });
    }

    console.log(`📦 Creating batch with ${requests.length} PDF requests`);

    const batch = await pdfAPI.processBatch(requests);

    res.json({
      success: true,
      batchId: batch.id,
      status: batch.processing_status,
      requestCount: requests.length,
      createdAt: batch.created_at
    });

  } catch (error) {
    console.error('❌ Batch creation error:', error);
    res.status(500).json({
      error: 'Batch creation failed',
      message: error.message
    });
  }
}

/**
 * Get batch processing status
 * GET /api/pdf/batch/:batchId
 */
export async function getBatchStatus(req, res) {
  try {
    const { batchId } = req.params;

    if (!batchId) {
      return res.status(400).json({
        error: 'Missing batch ID'
      });
    }

    const batch = await pdfAPI.getBatchStatus(batchId);

    res.json({
      success: true,
      batchId: batch.id,
      status: batch.processing_status,
      requestCounts: batch.request_counts,
      createdAt: batch.created_at,
      endedAt: batch.ended_at
    });

  } catch (error) {
    console.error(`❌ Error getting batch status for ${req.params.batchId}:`, error);
    res.status(500).json({
      error: 'Failed to get batch status',
      message: error.message
    });
  }
}

/**
 * Get batch results
 * GET /api/pdf/batch/:batchId/results
 */
export async function getBatchResults(req, res) {
  try {
    const { batchId } = req.params;

    if (!batchId) {
      return res.status(400).json({
        error: 'Missing batch ID'
      });
    }

    const results = await pdfAPI.getBatchResults(batchId);

    res.json({
      success: true,
      batchId,
      results
    });

  } catch (error) {
    console.error(`❌ Error getting batch results for ${req.params.batchId}:`, error);
    res.status(500).json({
      error: 'Failed to get batch results',
      message: error.message
    });
  }
}

// Middleware wrapper for multer upload
export const uploadMiddleware = upload.single('file');

export default {
  processPDF,
  uploadAndProcess,
  createBatch,
  getBatchStatus,
  getBatchResults,
  uploadMiddleware
};
