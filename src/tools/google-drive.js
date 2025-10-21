/**
 * Google Drive Integration Tools
 *
 * Provides access to Google Drive files including:
 * - Search for documents
 * - Read file contents (Google Docs, PDFs, plain text)
 */

import { google } from 'googleapis';

// OAuth2 credentials from environment
const GOOGLE_CLIENT_ID = process.env.GOOGLE_DRIVE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;

/**
 * Create authenticated Google Drive client
 * @returns {Object} Google Drive API client
 */
function createDriveClient() {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    throw new Error('Google Drive credentials not configured. Set GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, and GOOGLE_DRIVE_REFRESH_TOKEN.');
  }

  const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET
  );

  oauth2Client.setCredentials({
    refresh_token: GOOGLE_REFRESH_TOKEN
  });

  return google.drive({ version: 'v3', auth: oauth2Client });
}

/**
 * Search Google Drive for files
 * @param {string} query - Search query (file name or content keywords)
 * @param {string} fileType - Filter by file type: 'document', 'pdf', 'spreadsheet', or 'any'
 * @param {number} limit - Maximum number of results
 * @returns {Object} Search results
 */
export async function searchGoogleDrive(query, fileType = 'any', limit = 10) {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    return {
      success: false,
      error: 'Google Drive credentials not configured',
      files: []
    };
  }

  try {
    const drive = createDriveClient();

    // Build MIME type filter
    let mimeTypeQuery = '';

    if (fileType === 'document') {
      mimeTypeQuery = " and mimeType='application/vnd.google-apps.document'";
    } else if (fileType === 'pdf') {
      mimeTypeQuery = " and mimeType='application/pdf'";
    } else if (fileType === 'spreadsheet') {
      mimeTypeQuery = " and mimeType='application/vnd.google-apps.spreadsheet'";
    }

    // Escape single quotes in query
    const escapedQuery = query.replace(/'/g, "\\'");

    // Build search query
    const searchQuery = `fullText contains '${escapedQuery}' and trashed=false${mimeTypeQuery}`;

    const response = await drive.files.list({
      q: searchQuery,
      fields: 'files(id, name, mimeType, createdTime, modifiedTime, webViewLink, size)',
      pageSize: limit,
      orderBy: 'modifiedTime desc'
    });

    console.log(`✓ Google Drive search: found ${response.data.files.length} results`);

    return {
      success: true,
      count: response.data.files.length,
      files: response.data.files.map(file => ({
        id: file.id,
        name: file.name,
        type: file.mimeType,
        url: file.webViewLink,
        size: file.size,
        created: file.createdTime,
        modified: file.modifiedTime
      }))
    };
  } catch (error) {
    console.error('Google Drive search error:', error.message);
    return {
      success: false,
      error: error.message,
      files: []
    };
  }
}

/**
 * Read Google Drive file content
 * @param {string} fileId - Google Drive file ID
 * @returns {Object} File content and metadata
 */
export async function readGoogleDriveFile(fileId) {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    return {
      success: false,
      error: 'Google Drive credentials not configured'
    };
  }

  try {
    const drive = createDriveClient();

    // Get file metadata first
    const metadata = await drive.files.get({
      fileId: fileId,
      fields: 'id, name, mimeType, webViewLink'
    });

    let content = '';
    const mimeType = metadata.data.mimeType;

    console.log(`Reading file: ${metadata.data.name} (${mimeType})`);

    // Handle different file types
    if (mimeType === 'application/vnd.google-apps.document') {
      // Google Docs - export as plain text
      const response = await drive.files.export({
        fileId: fileId,
        mimeType: 'text/plain'
      });
      content = response.data;
    } else if (mimeType === 'application/pdf') {
      // PDF - download as binary and convert to base64
      const response = await drive.files.get({
        fileId: fileId,
        alt: 'media'
      }, { responseType: 'arraybuffer' });

      content = '[PDF file - binary content not displayed. File size: ' +
                response.data.byteLength + ' bytes]';
      // Note: For actual PDF text extraction, you'd need a PDF parser
    } else if (mimeType === 'text/plain' || mimeType.startsWith('text/')) {
      // Plain text or other text files
      const response = await drive.files.get({
        fileId: fileId,
        alt: 'media'
      }, { responseType: 'text' });
      content = response.data;
    } else {
      return {
        success: false,
        error: `Unsupported file type: ${mimeType}`
      };
    }

    // Limit content length to avoid token overload
    const MAX_LENGTH = 50000; // ~50K characters
    if (content.length > MAX_LENGTH) {
      content = content.substring(0, MAX_LENGTH) + '\n\n[Content truncated...]';
      console.log(`⚠️  File content truncated from ${content.length} to ${MAX_LENGTH} characters`);
    }

    console.log(`✓ Google Drive file read: ${metadata.data.name} (${content.length} chars)`);

    return {
      success: true,
      file: {
        id: metadata.data.id,
        name: metadata.data.name,
        type: metadata.data.mimeType,
        url: metadata.data.webViewLink
      },
      content: content,
      truncated: content.length > MAX_LENGTH
    };
  } catch (error) {
    console.error('Google Drive read file error:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * List files in a specific folder (utility function)
 * @param {string} folderId - Google Drive folder ID
 * @param {number} limit - Maximum number of results
 * @returns {Object} List of files
 */
export async function listFilesInFolder(folderId, limit = 20) {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    return {
      success: false,
      error: 'Google Drive credentials not configured',
      files: []
    };
  }

  try {
    const drive = createDriveClient();

    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'files(id, name, mimeType, modifiedTime, webViewLink)',
      pageSize: limit,
      orderBy: 'modifiedTime desc'
    });

    console.log(`✓ Google Drive folder list: found ${response.data.files.length} files`);

    return {
      success: true,
      count: response.data.files.length,
      files: response.data.files.map(file => ({
        id: file.id,
        name: file.name,
        type: file.mimeType,
        url: file.webViewLink,
        modified: file.modifiedTime
      }))
    };
  } catch (error) {
    console.error('Google Drive list files error:', error.message);
    return {
      success: false,
      error: error.message,
      files: []
    };
  }
}
