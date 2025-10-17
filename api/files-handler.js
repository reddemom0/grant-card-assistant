/**
 * Files API Handler for Railway
 * Handles file uploads, downloads, and management via Anthropic Files API
 */
import multer from 'multer';
import { filesAPI, getMimeType, getContentBlockType } from '../src/anthropic-client.js';
import * as db from '../src/database-service.js';

// Configure multer for memory storage (files kept in RAM for upload)
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB max
    files: 20, // Max 20 files per request
  },
  fileFilter: (req, file, cb) => {
    const mimeType = getMimeType(file.originalname);
    if (!mimeType) {
      cb(new Error(`Unsupported file type: ${file.originalname}`));
      return;
    }
    cb(null, true);
  },
});

/**
 * Upload files to Anthropic Files API
 * POST /api/files
 */
export async function uploadFiles(req, res) {
  try {
    const { conversationId, userId } = req.body;

    if (!conversationId || !userId) {
      return res.status(400).json({
        error: 'Missing required fields: conversationId, userId'
      });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        error: 'No files provided'
      });
    }

    console.log(`📤 Uploading ${req.files.length} file(s) for conversation ${conversationId}`);

    // Ensure user exists
    const user = await db.ensureUser(userId);

    // Upload each file to Anthropic
    const uploadedFiles = [];
    const errors = [];

    for (const file of req.files) {
      try {
        const mimeType = getMimeType(file.originalname);
        const contentBlockType = getContentBlockType(file.originalname);

        // Validate file
        const validation = filesAPI.validateFile(file.originalname, file.size);
        if (!validation.valid) {
          errors.push({
            filename: file.originalname,
            errors: validation.errors
          });
          continue;
        }

        // Upload to Anthropic
        const uploadedFile = await filesAPI.upload(
          null, // No file path needed for buffer upload
          file.originalname,
          mimeType,
          file.buffer
        );

        uploadedFiles.push({
          file_id: uploadedFile.id,
          filename: uploadedFile.filename,
          size_bytes: uploadedFile.size_bytes,
          mime_type: mimeType,
          content_block_type: contentBlockType,
          created_at: uploadedFile.created_at,
        });

      } catch (error) {
        console.error(`❌ Failed to upload ${file.originalname}:`, error);
        errors.push({
          filename: file.originalname,
          error: error.message
        });
      }
    }

    // Store file references in conversation context
    if (uploadedFiles.length > 0) {
      try {
        const conversation = await db.getConversation(conversationId);
        if (conversation) {
          // Add files to conversation metadata
          const existingFiles = conversation.file_context?.files || [];
          const updatedFiles = [...existingFiles, ...uploadedFiles];

          await db.updateConversationFileContext(conversationId, {
            files: updatedFiles,
            last_updated: new Date().toISOString()
          });

          console.log(`✅ Stored ${uploadedFiles.length} file reference(s) in conversation ${conversationId}`);
        }
      } catch (dbError) {
        console.error('⚠️ Failed to store file references in conversation:', dbError);
      }
    }

    res.json({
      success: true,
      uploaded: uploadedFiles,
      errors: errors.length > 0 ? errors : undefined,
      count: uploadedFiles.length
    });

  } catch (error) {
    console.error('❌ Upload handler error:', error);
    res.status(500).json({
      error: 'File upload failed',
      message: error.message
    });
  }
}

/**
 * List all files for a conversation
 * GET /api/files?conversationId=xxx
 */
export async function listFiles(req, res) {
  try {
    const { conversationId } = req.query;

    if (!conversationId) {
      // List all files from Anthropic API
      const files = await filesAPI.list();
      return res.json({
        success: true,
        files,
        count: files.length
      });
    }

    // Get files for specific conversation
    const conversation = await db.getConversation(conversationId);
    if (!conversation) {
      return res.status(404).json({
        error: 'Conversation not found'
      });
    }

    const files = conversation.file_context?.files || [];
    res.json({
      success: true,
      files,
      count: files.length
    });

  } catch (error) {
    console.error('❌ List files error:', error);
    res.status(500).json({
      error: 'Failed to list files',
      message: error.message
    });
  }
}

/**
 * Get file metadata
 * GET /api/files/:fileId
 */
export async function getFileMetadata(req, res) {
  try {
    const { fileId } = req.params;

    if (!fileId) {
      return res.status(400).json({
        error: 'File ID required'
      });
    }

    const metadata = await filesAPI.getMetadata(fileId);

    res.json({
      success: true,
      file: metadata
    });

  } catch (error) {
    console.error(`❌ Get metadata error for ${req.params.fileId}:`, error);
    res.status(500).json({
      error: 'Failed to get file metadata',
      message: error.message
    });
  }
}

/**
 * Delete a file
 * DELETE /api/files/:fileId
 */
export async function deleteFile(req, res) {
  try {
    const { fileId } = req.params;
    const { conversationId } = req.query;

    if (!fileId) {
      return res.status(400).json({
        error: 'File ID required'
      });
    }

    // Delete from Anthropic
    await filesAPI.delete(fileId);

    // Remove from conversation context if conversationId provided
    if (conversationId) {
      try {
        const conversation = await db.getConversation(conversationId);
        if (conversation && conversation.file_context?.files) {
          const updatedFiles = conversation.file_context.files.filter(
            f => f.file_id !== fileId
          );

          await db.updateConversationFileContext(conversationId, {
            files: updatedFiles,
            last_updated: new Date().toISOString()
          });

          console.log(`✅ Removed file ${fileId} from conversation ${conversationId}`);
        }
      } catch (dbError) {
        console.error('⚠️ Failed to update conversation context:', dbError);
      }
    }

    res.json({
      success: true,
      message: 'File deleted successfully'
    });

  } catch (error) {
    console.error(`❌ Delete file error for ${req.params.fileId}:`, error);
    res.status(500).json({
      error: 'Failed to delete file',
      message: error.message
    });
  }
}

/**
 * Download a file (only for files created by code execution tool)
 * GET /api/files/:fileId/download
 */
export async function downloadFile(req, res) {
  try {
    const { fileId } = req.params;

    if (!fileId) {
      return res.status(400).json({
        error: 'File ID required'
      });
    }

    // Get file metadata first to get filename
    const metadata = await filesAPI.getMetadata(fileId);

    // Download file content
    const content = await filesAPI.download(fileId);

    // Set appropriate headers
    res.setHeader('Content-Disposition', `attachment; filename="${metadata.filename}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.send(content);

  } catch (error) {
    console.error(`❌ Download file error for ${req.params.fileId}:`, error);
    res.status(500).json({
      error: 'Failed to download file',
      message: error.message,
      note: 'Downloads only work for files created by code execution tool'
    });
  }
}

// Middleware wrapper for multer upload
export const uploadMiddleware = upload.array('files', 20);

export default {
  uploadFiles,
  listFiles,
  getFileMetadata,
  deleteFile,
  downloadFile,
  uploadMiddleware
};
