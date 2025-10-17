/**
 * Anthropic API Client Service
 * Handles direct API calls to Anthropic for Files API and other features
 * not available through Agent SDK
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from 'dotenv';

config();

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Beta header for Files API
const FILES_API_BETA = 'files-api-2025-04-14';

/**
 * Files API Service
 */
export const filesAPI = {
  /**
   * Upload a file to Anthropic
   * @param {string} filePath - Path to file on disk
   * @param {string} filename - Original filename
   * @param {string} mimeType - MIME type of the file
   * @param {Buffer} fileData - File content as Buffer
   * @returns {Promise<object>} File metadata with file_id
   */
  async upload(filePath, filename, mimeType, fileData) {
    try {
      const file = await anthropic.beta.files.upload({
        file: [filename, fileData, mimeType]
      }, {
        headers: {
          'anthropic-beta': FILES_API_BETA
        }
      });

      console.log(`✅ Uploaded file: ${file.id} (${filename}, ${(file.size_bytes / 1024).toFixed(2)} KB)`);

      return file;
    } catch (error) {
      console.error('❌ File upload error:', error);
      throw new Error(`File upload failed: ${error.message}`);
    }
  },

  /**
   * List all uploaded files
   * @returns {Promise<array>} Array of file metadata objects
   */
  async list() {
    try {
      const response = await anthropic.beta.files.list({
        headers: {
          'anthropic-beta': FILES_API_BETA
        }
      });

      return response.data || [];
    } catch (error) {
      console.error('❌ File list error:', error);
      throw new Error(`Failed to list files: ${error.message}`);
    }
  },

  /**
   * Get metadata for a specific file
   * @param {string} fileId - The file ID
   * @returns {Promise<object>} File metadata
   */
  async getMetadata(fileId) {
    try {
      const file = await anthropic.beta.files.retrieveMetadata(fileId, {
        headers: {
          'anthropic-beta': FILES_API_BETA
        }
      });

      return file;
    } catch (error) {
      console.error(`❌ File metadata error for ${fileId}:`, error);
      throw new Error(`Failed to get file metadata: ${error.message}`);
    }
  },

  /**
   * Delete a file
   * @param {string} fileId - The file ID to delete
   * @returns {Promise<object>} Deletion confirmation
   */
  async delete(fileId) {
    try {
      const result = await anthropic.beta.files.delete(fileId, {
        headers: {
          'anthropic-beta': FILES_API_BETA
        }
      });

      console.log(`✅ Deleted file: ${fileId}`);

      return result;
    } catch (error) {
      console.error(`❌ File deletion error for ${fileId}:`, error);
      throw new Error(`Failed to delete file: ${error.message}`);
    }
  },

  /**
   * Download a file (only for files created by code execution tool)
   * @param {string} fileId - The file ID to download
   * @returns {Promise<Buffer>} File content
   */
  async download(fileId) {
    try {
      const content = await anthropic.beta.files.download(fileId, {
        headers: {
          'anthropic-beta': FILES_API_BETA
        }
      });

      console.log(`✅ Downloaded file: ${fileId}`);

      return content;
    } catch (error) {
      console.error(`❌ File download error for ${fileId}:`, error);
      throw new Error(`Failed to download file: ${error.message}`);
    }
  },

  /**
   * Create a document content block from file ID
   * @param {string} fileId - The file ID
   * @param {object} options - Optional parameters (title, context, citations)
   * @returns {object} Document content block
   */
  createDocumentBlock(fileId, options = {}) {
    const block = {
      type: 'document',
      source: {
        type: 'file',
        file_id: fileId
      }
    };

    if (options.title) block.title = options.title;
    if (options.context) block.context = options.context;
    if (options.citations) block.citations = { enabled: true };

    return block;
  },

  /**
   * Create an image content block from file ID
   * @param {string} fileId - The file ID
   * @returns {object} Image content block
   */
  createImageBlock(fileId) {
    return {
      type: 'image',
      source: {
        type: 'file',
        file_id: fileId
      }
    };
  },

  /**
   * Validate file before upload
   * @param {string} filename - Original filename
   * @param {number} fileSize - File size in bytes
   * @returns {object} Validation result
   */
  validateFile(filename, fileSize) {
    const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500 MB
    const FORBIDDEN_CHARS = /[<>:"|?*\\/\u0000-\u001f]/;

    const errors = [];

    // Check filename length
    if (filename.length < 1 || filename.length > 255) {
      errors.push('Filename must be between 1-255 characters');
    }

    // Check forbidden characters
    if (FORBIDDEN_CHARS.test(filename)) {
      errors.push('Filename contains forbidden characters');
    }

    // Check file size
    if (fileSize > MAX_FILE_SIZE) {
      errors.push(`File exceeds maximum size of 500 MB (${(fileSize / 1024 / 1024).toFixed(2)} MB)`);
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
};

/**
 * Supported file types for Files API
 */
export const SUPPORTED_FILE_TYPES = {
  // Document types
  pdf: { mimeType: 'application/pdf', contentBlock: 'document' },
  txt: { mimeType: 'text/plain', contentBlock: 'document' },

  // Image types
  jpg: { mimeType: 'image/jpeg', contentBlock: 'image' },
  jpeg: { mimeType: 'image/jpeg', contentBlock: 'image' },
  png: { mimeType: 'image/png', contentBlock: 'image' },
  gif: { mimeType: 'image/gif', contentBlock: 'image' },
  webp: { mimeType: 'image/webp', contentBlock: 'image' },
};

/**
 * Get MIME type from file extension
 * @param {string} filename - The filename
 * @returns {string|null} MIME type or null if unsupported
 */
export function getMimeType(filename) {
  const ext = filename.split('.').pop()?.toLowerCase();
  return SUPPORTED_FILE_TYPES[ext]?.mimeType || null;
}

/**
 * Get content block type from file extension
 * @param {string} filename - The filename
 * @returns {string|null} Content block type or null if unsupported
 */
export function getContentBlockType(filename) {
  const ext = filename.split('.').pop()?.toLowerCase();
  return SUPPORTED_FILE_TYPES[ext]?.contentBlock || null;
}

export default anthropic;
