/**
 * Google Drive Integration Tools
 *
 * Provides access to Google Drive files including:
 * - Search for documents
 * - Read file contents (Google Docs, PDFs, plain text, Word .docx, Excel .xlsx)
 */

import { google } from 'googleapis';
import { PDFParse, VerbosityLevel } from 'pdf-parse';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';

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
 * @param {boolean} readOnly - If true, use read-only scopes. If false, use full drive access
 * @returns {Object} Google Drive API client
 */
function createDriveClient(userEmail = null, readOnly = false) {
  // Try Service Account first (most reliable, works with domain-wide delegation)
  if (GOOGLE_SERVICE_ACCOUNT_KEY) {
    try {
      const serviceAccount = JSON.parse(GOOGLE_SERVICE_ACCOUNT_KEY);

      const authConfig = {
        credentials: serviceAccount,
        scopes: readOnly ? [
          'https://www.googleapis.com/auth/drive.readonly',
          'https://www.googleapis.com/auth/documents.readonly'
        ] : [
          'https://www.googleapis.com/auth/drive',
          'https://www.googleapis.com/auth/documents',
          'https://www.googleapis.com/auth/spreadsheets'
        ]
      };

      // If userEmail provided, use domain-wide delegation to impersonate that user
      // This allows accessing files the user has access to without manual sharing.
      // The subject MUST go in clientOptions: google-auth-library ignores a
      // top-level `subject` on GoogleAuthOptions, so setting it there silently
      // produced a non-impersonated client (verified against v9.15.1).
      if (userEmail) {
        console.log(`Using Service Account with domain-wide delegation (impersonating: ${userEmail})`);
        authConfig.clientOptions = { subject: userEmail };
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
    const drive = createDriveClient(userEmail, true); // Read-only access

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
      fields: 'files(id, name, mimeType, createdTime, modifiedTime, webViewLink, size, driveId)',
      pageSize: limit,
      orderBy: 'modifiedTime desc',
      // Shared Drive content is invisible without these; corpora is left at its
      // default so My Drive and shared-with-me results still come back too.
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
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
 * Extract file or folder ID from Google Drive URL, or return as-is if already an ID
 * @param {string} fileIdOrUrl - Google Drive file/folder ID or URL
 * @returns {string} File or folder ID
 */
function extractFileId(fileIdOrUrl) {
  // If it looks like a URL, extract the file ID
  if (fileIdOrUrl.includes('drive.google.com') || fileIdOrUrl.includes('docs.google.com')) {
    // Match patterns like:
    // https://drive.google.com/file/d/FILE_ID/...
    // https://docs.google.com/document/d/FILE_ID/...
    // https://docs.google.com/spreadsheets/d/FILE_ID/...
    // https://drive.google.com/drive/folders/FOLDER_ID?usp=sharing
    // https://drive.google.com/open?id=FILE_ID
    const match = fileIdOrUrl.match(/\/(?:d|folders)\/([a-zA-Z0-9_-]+)/) ||
                  fileIdOrUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
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
  // Extract file ID if URL was provided
  const fileId = extractFileId(fileIdOrUrl);
  console.log(`Extracted file ID: ${fileId} from input: ${fileIdOrUrl.substring(0, 100)}...`);

  try {
    // Read as the requesting user when we know who they are. If that identity
    // can't see the file (403/404), fall back to the service account's own
    // access so files shared directly with the service account still open.
    if (userEmail) {
      try {
        const result = await fetchDriveFileContent(createDriveClient(userEmail, true), fileId);
        console.log(`✓ Read as user: ${userEmail}`);
        return result;
      } catch (userError) {
        const status = userError?.code ?? userError?.response?.status;
        if (status !== 403 && status !== 404) throw userError;
        console.warn(`Read as ${userEmail} failed (${status}) - retrying as service account`);
      }
    }

    const result = await fetchDriveFileContent(createDriveClient(null, true), fileId);
    console.log('✓ Read as service account');
    return result;
  } catch (error) {
    console.error('Google Drive read file error:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

// Uploaded files above this are never downloaded. Office files are zip archives
// that inflate well beyond their stored size, so this bounds memory and parse time
// for PDFs, Word and Excel. Native Google Docs have no stored size and are exported.
const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024;

// Row cap per Excel sheet: the size check is on the compressed file, so this bounds
// what a small but highly compressed workbook can expand into.
const MAX_SHEET_ROWS = 5000;

/**
 * Fetch one file's metadata and text content with an already-authenticated client
 * @param {Object} drive - Authenticated Google Drive client
 * @param {string} fileId - Google Drive file ID
 * @returns {Object} File content and metadata
 */
async function fetchDriveFileContent(drive, fileId) {
  // Get file metadata first
  const metadata = await drive.files.get({
    fileId: fileId,
    fields: 'id, name, mimeType, webViewLink, size',
    supportsAllDrives: true
  });

  let content = '';
  const mimeType = metadata.data.mimeType;

  console.log(`Reading file: ${metadata.data.name} (${mimeType})`);

  // Too large to download: return a readable note rather than an error, so the
  // agent can ask for a smaller export instead of reporting a failure.
  const sizeBytes = Number(metadata.data.size);
  if (sizeBytes > MAX_DOWNLOAD_BYTES) {
    const mb = bytes => (bytes / (1024 * 1024)).toFixed(1);
    console.log(`⚠️  File too large to read: ${metadata.data.name} (${mb(sizeBytes)} MB)`);
    return {
      success: true,
      file: {
        id: metadata.data.id,
        name: metadata.data.name,
        type: metadata.data.mimeType,
        url: metadata.data.webViewLink
      },
      content: `[File too large to read (${mb(sizeBytes)} MB; limit ${mb(MAX_DOWNLOAD_BYTES)} MB). Ask for a smaller export — for example just the relevant sheet or pages.]`,
      tooLarge: true,
      truncated: false
    };
  }

  // Handle different file types
  if (mimeType === 'application/vnd.google-apps.document') {
    // Google Docs - export as plain text
    // files.export takes no supportsAllDrives parameter; it resolves by file ID
    // and inherits the caller's access, so Shared Drive files export fine.
    const response = await drive.files.export({
      fileId: fileId,
      mimeType: 'text/plain'
    });
    content = response.data;
  } else if (mimeType === 'application/pdf') {
    // PDF - download and extract text
    console.log('📄 Extracting text from PDF...');
    const response = await drive.files.get({
      fileId: fileId,
      alt: 'media',
      supportsAllDrives: true
    }, { responseType: 'arraybuffer' });

    try {
      // Extract text from PDF using pdf-parse v2 (PDFParse class API)
      const pdfBuffer = Buffer.from(response.data);
      const parser = new PDFParse({ data: pdfBuffer, verbosity: VerbosityLevel.ERRORS });
      const pdfData = await parser.getText();
      content = pdfData.text;
      console.log(`✓ PDF text extracted: ${pdfData.total} pages, ${content.length} characters`);
    } catch (pdfError) {
      console.error('❌ PDF text extraction failed:', pdfError.message);
      content = `[PDF file - text extraction failed: ${pdfError.message}. File size: ${response.data.byteLength} bytes]`;
    }
  } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    // Uploaded Word file (.docx) - download and extract raw text
    const response = await drive.files.get({
      fileId: fileId,
      alt: 'media',
      supportsAllDrives: true
    }, { responseType: 'arraybuffer' });

    try {
      const result = await mammoth.extractRawText({ buffer: Buffer.from(response.data) });
      content = result.value;
      console.log(`✓ Word text extracted: ${content.length} characters`);
    } catch (docxError) {
      console.error('❌ Word text extraction failed:', docxError.message);
      content = `[Word file - text extraction failed: ${docxError.message}. File size: ${response.data.byteLength} bytes]`;
    }
  } else if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
    // Uploaded Excel file (.xlsx) - download and convert each sheet to CSV
    const response = await drive.files.get({
      fileId: fileId,
      alt: 'media',
      supportsAllDrives: true
    }, { responseType: 'arraybuffer' });

    try {
      const workbook = XLSX.read(Buffer.from(response.data), { type: 'buffer', sheetRows: MAX_SHEET_ROWS });
      content = workbook.SheetNames
        .map(name => `=== Sheet: ${name} ===\n${XLSX.utils.sheet_to_csv(workbook.Sheets[name])}`)
        .join('\n\n');
      console.log(`✓ Excel text extracted: ${workbook.SheetNames.length} sheets, ${content.length} characters`);
    } catch (xlsxError) {
      console.error('❌ Excel text extraction failed:', xlsxError.message);
      content = `[Excel file - text extraction failed: ${xlsxError.message}. File size: ${response.data.byteLength} bytes]`;
    }
  } else if (mimeType === 'text/plain' || mimeType.startsWith('text/')) {
    // Plain text or other text files
    const response = await drive.files.get({
      fileId: fileId,
      alt: 'media',
      supportsAllDrives: true
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
}

/**
 * List files in a specific folder
 * @param {string} folderIdOrUrl - Google Drive folder ID or full folder URL
 * @param {number} limit - Maximum number of results
 * @param {string} userEmail - Optional: User email for domain-wide delegation
 * @returns {Object} List of files, with `truncated` true when the folder holds more
 */
export async function listFilesInFolder(folderIdOrUrl, limit = 20, userEmail = null) {
  try {
    // Accept a pasted folder link as well as a bare ID
    const folderId = extractFileId(folderIdOrUrl);

    const drive = createDriveClient(userEmail, true); // Read-only access

    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, webViewLink)',
      pageSize: limit,
      orderBy: 'modifiedTime desc',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    });

    // A next page token means Drive has more items than it returned. Drive can
    // also return a short page with a token, so the token is the signal, not
    // the count. The token itself is not returned: there is no paging to use it.
    const truncated = Boolean(response.data.nextPageToken);

    console.log(`✓ Google Drive folder list: found ${response.data.files.length} files${truncated ? ' (truncated)' : ''}`);

    // `truncated` sits before `files` so it survives compaction, which keeps
    // only the first 500 characters of an old tool result.
    return {
      success: true,
      count: response.data.files.length,
      truncated,
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

/**
 * Create a new folder in Google Drive
 * @param {string} folderName - Name for the new folder
 * @param {number} userId - User ID (for OAuth-based access)
 * @returns {Object} Created folder information
 */
export async function createGoogleDriveFolder(folderName, userId) {
  try {
    console.log(`Creating Google Drive folder: "${folderName}" for user ID: ${userId}`);

    // Get user's OAuth credentials
    const { query } = await import('../database/connection.js');
    const result = await query(
      'SELECT google_access_token, google_refresh_token, google_token_expiry FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      throw new Error('User not found');
    }

    const user = result.rows[0];

    if (!user.google_access_token) {
      throw new Error('User has not connected Google account');
    }

    // Create OAuth2 client with user's tokens
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );

    oauth2Client.setCredentials({
      access_token: user.google_access_token,
      refresh_token: user.google_refresh_token,
      expiry_date: user.google_token_expiry ? new Date(user.google_token_expiry).getTime() : null
    });

    // Create Drive client with write permissions
    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    // Create the folder
    const folderMetadata = {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder'
    };

    const folder = await drive.files.create({
      resource: folderMetadata,
      fields: 'id, name, webViewLink',
      supportsAllDrives: true
    });

    console.log(`✓ Created Google Drive folder: ${folder.data.name} (ID: ${folder.data.id})`);

    return {
      success: true,
      folder: {
        id: folder.data.id,
        name: folder.data.name,
        url: folder.data.webViewLink
      }
    };
  } catch (error) {
    console.error('Google Drive create folder error:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Upload a file to Google Drive
 * @param {string} fileName - Name for the uploaded file
 * @param {string} content - File content (text/markdown)
 * @param {string} mimeType - MIME type (e.g., 'text/markdown', 'text/plain')
 * @param {string} folderId - Optional: Folder ID to place the file in
 * @returns {Object} Uploaded file information
 */
export async function uploadFileToGoogleDrive(fileName, content, mimeType = 'text/plain', folderId = null) {
  try {
    console.log(`Uploading file to Google Drive: "${fileName}" (${mimeType})`);

    // Use Service Account for knowledge base uploads
    const drive = createDriveClient(null, false); // Write access

    const fileMetadata = {
      name: fileName,
      mimeType: mimeType
    };

    // Add parent folder if specified
    if (folderId) {
      fileMetadata.parents = [folderId];
    }

    const media = {
      mimeType: mimeType,
      body: content
    };

    const file = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: 'id, name, webViewLink, mimeType',
      supportsAllDrives: true
    });

    console.log(`✓ File uploaded successfully: ${file.data.name} (ID: ${file.data.id})`);

    return {
      success: true,
      file: {
        id: file.data.id,
        name: file.data.name,
        url: file.data.webViewLink,
        mimeType: file.data.mimeType
      }
    };
  } catch (error) {
    console.error('Google Drive upload error:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Copy a template file in Google Drive (for CanExport templates)
 * @param {string} templateFileIdOrName - Source file ID or name to search for
 * @param {string} newFileName - Name for the copied file
 * @param {string} targetFolderId - Optional: Folder ID to place the copy in
 * @param {number} userId - User ID (for OAuth-based access)
 * @returns {Object} Copied file information
 */
export async function copyTemplateFile(templateFileIdOrName, newFileName, targetFolderId, userId) {
  try {
    console.log(`Copying template: "${templateFileIdOrName}" → "${newFileName}"`);

    // Get user's OAuth credentials
    const { query } = await import('../database/connection.js');
    const result = await query(
      'SELECT google_access_token, google_refresh_token, google_token_expiry FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      throw new Error('User not found');
    }

    const user = result.rows[0];

    if (!user.google_access_token) {
      throw new Error('User has not connected Google account');
    }

    // Create OAuth2 client with user's tokens
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );

    oauth2Client.setCredentials({
      access_token: user.google_access_token,
      refresh_token: user.google_refresh_token,
      expiry_date: user.google_token_expiry ? new Date(user.google_token_expiry).getTime() : null
    });

    // Create Drive client
    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    // Step 1: Find the template file if name was provided instead of ID
    let templateFileId = templateFileIdOrName;

    // Check if it's a file ID (looks like alphanumeric string) or a name
    if (!templateFileIdOrName.match(/^[a-zA-Z0-9_-]{20,}$/)) {
      // It's a name, search for it
      console.log(`Searching for template file: "${templateFileIdOrName}"`);
      const searchResponse = await drive.files.list({
        q: `name='${templateFileIdOrName}' and trashed=false`,
        fields: 'files(id, name)',
        pageSize: 1,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true
      });

      if (searchResponse.data.files.length === 0) {
        throw new Error(`Template file not found: ${templateFileIdOrName}`);
      }

      templateFileId = searchResponse.data.files[0].id;
      console.log(`Found template file ID: ${templateFileId}`);
    }

    // Step 2: Copy the file
    const copyMetadata = {
      name: newFileName
    };

    // Add parent folder if specified
    if (targetFolderId) {
      copyMetadata.parents = [targetFolderId];
    }

    const copiedFile = await drive.files.copy({
      fileId: templateFileId,
      resource: copyMetadata,
      fields: 'id, name, webViewLink, mimeType',
      supportsAllDrives: true
    });

    console.log(`✓ Template copied successfully: ${copiedFile.data.name}`);

    return {
      success: true,
      file: {
        id: copiedFile.data.id,
        name: copiedFile.data.name,
        url: copiedFile.data.webViewLink,
        mimeType: copiedFile.data.mimeType
      }
    };
  } catch (error) {
    console.error('Google Drive copy template error:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * A Doc's name and how many of its comments are still open — for tracked cards.
 *
 * Read with the same read-only client as readGoogleDriveFile (drive.readonly,
 * impersonating `userEmail` through domain-wide delegation), so it sees exactly
 * what that person can see. comments.list accepts drive.readonly; no new scope.
 * Open = neither resolved nor deleted. Nothing about the comments' content is
 * read or returned.
 *
 * @param {string} fileId
 * @param {string|null} userEmail - person to read as
 * @returns {Promise<{fileId: string, name: string|null, openComments: number|null, readable: boolean, code?: string}>}
 */
export async function getDocCommentSummary(fileId, userEmail = null) {
  try {
    const drive = createDriveClient(userEmail, true);
    const meta = await drive.files.get({ fileId, fields: 'name', supportsAllDrives: true });

    let open = 0;
    let pageToken;
    let pages = 0;
    do {
      const res = await drive.comments.list({
        fileId,
        pageSize: 100,
        pageToken,
        includeDeleted: false,
        fields: 'nextPageToken, comments(resolved, deleted)'
      });
      for (const c of res.data.comments || []) {
        if (!c.resolved && !c.deleted) open++;
      }
      pageToken = res.data.nextPageToken || undefined;
      pages++;
    } while (pageToken && pages < 20);

    return { fileId, name: meta.data.name || null, openComments: open, readable: true };
  } catch (err) {
    const code = String(err?.code ?? err?.response?.status ?? 'unknown');
    // Code only — Google's error text can carry the impersonated address.
    console.warn(`⚠️  Doc comment summary unavailable — code: ${code}`);
    return { fileId, name: null, openComments: null, readable: false, code };
  }
}
