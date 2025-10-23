/**
 * Google Drive Integration Tools
 *
 * Provides access to Google Drive files including:
 * - Search for documents
 * - Read file contents (Google Docs, PDFs, plain text)
 */

import { google } from 'googleapis';

// OAuth2 credentials from environment (for user access)
const GOOGLE_CLIENT_ID = process.env.GOOGLE_DRIVE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;

// Service Account credentials from environment (for knowledge base access)
const GOOGLE_SERVICE_ACCOUNT_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

/**
 * Create authenticated Google Drive client
 * Tries Service Account with domain-wide delegation first, falls back to OAuth2
 * @param {string} userEmail - Optional: User email to impersonate (for domain-wide delegation)
 * @returns {Object} Google Drive API client
 */
function createDriveClient(userEmail = null) {
  // Try Service Account first (most reliable, works with domain-wide delegation)
  if (GOOGLE_SERVICE_ACCOUNT_KEY) {
    try {
      const serviceAccount = JSON.parse(GOOGLE_SERVICE_ACCOUNT_KEY);

      const authConfig = {
        credentials: serviceAccount,
        scopes: [
          'https://www.googleapis.com/auth/drive.readonly',
          'https://www.googleapis.com/auth/documents.readonly'
        ]
      };

      // If userEmail provided, use domain-wide delegation to impersonate that user
      // This allows accessing files the user has access to without manual sharing
      if (userEmail) {
        console.log(`Using Service Account with domain-wide delegation (impersonating: ${userEmail})`);
        authConfig.subject = userEmail;
      } else {
        console.log('Using Service Account credentials for Google Drive');
      }

      const auth = new google.auth.GoogleAuth(authConfig);
      return google.drive({ version: 'v3', auth });
    } catch (error) {
      console.error('Service Account auth failed:', error.message);
      // Fall through to OAuth2
    }
  }

  // Fall back to OAuth2 (requires valid refresh token)
  if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REFRESH_TOKEN) {
    console.log('Using OAuth2 credentials for Google Drive');
    const oauth2Client = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET
    );

    oauth2Client.setCredentials({
      refresh_token: GOOGLE_REFRESH_TOKEN
    });

    return google.drive({ version: 'v3', auth: oauth2Client });
  }

  throw new Error('Google Drive credentials not configured. Set either GOOGLE_SERVICE_ACCOUNT_KEY or (GOOGLE_DRIVE_CLIENT_ID + GOOGLE_DRIVE_CLIENT_SECRET + GOOGLE_DRIVE_REFRESH_TOKEN).');
}

/**
 * Search Google Drive for files
 * @param {string} query - Search query (file name or content keywords)
 * @param {string} fileType - Filter by file type: 'document', 'pdf', 'spreadsheet', or 'any'
 * @param {number} limit - Maximum number of results
 * @param {string} userEmail - Optional: User email for domain-wide delegation
 * @returns {Object} Search results
 */
export async function searchGoogleDrive(query, fileType = 'any', limit = 10, userEmail = null) {
  try {
    const drive = createDriveClient(userEmail);

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
 * Extract file ID from Google Drive URL or return as-is if already an ID
 * @param {string} fileIdOrUrl - Google Drive file ID or URL
 * @returns {string} File ID
 */
function extractFileId(fileIdOrUrl) {
  // If it looks like a URL, extract the file ID
  if (fileIdOrUrl.includes('drive.google.com') || fileIdOrUrl.includes('docs.google.com')) {
    // Match patterns like:
    // https://drive.google.com/file/d/FILE_ID/...
    // https://docs.google.com/document/d/FILE_ID/...
    // https://docs.google.com/spreadsheets/d/FILE_ID/...
    const match = fileIdOrUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (match) {
      return match[1];
    }
  }

  // Otherwise assume it's already a file ID
  return fileIdOrUrl;
}

/**
 * Read Google Drive file content
 * @param {string} fileIdOrUrl - Google Drive file ID or full URL
 * @param {string} userEmail - Optional: User email for domain-wide delegation
 * @returns {Object} File content and metadata
 */
export async function readGoogleDriveFile(fileIdOrUrl, userEmail = null) {
  try {
    // Extract file ID if URL was provided
    const fileId = extractFileId(fileIdOrUrl);
    console.log(`Extracted file ID: ${fileId} from input: ${fileIdOrUrl.substring(0, 100)}...`);

    const drive = createDriveClient(userEmail);

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
 * @param {string} userEmail - Optional: User email for domain-wide delegation
 * @returns {Object} List of files
 */
export async function listFilesInFolder(folderId, limit = 20, userEmail = null) {
  try {
    const drive = createDriveClient(userEmail);

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
