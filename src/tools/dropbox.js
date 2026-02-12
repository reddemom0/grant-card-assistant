/**
 * Dropbox Integration Tools
 *
 * Provides access to Dropbox team files including:
 * - Search for documents
 * - List files in folders
 * - Read file contents (text, PDFs, DOCX)
 */

import fetch from 'node-fetch';
import mammoth from 'mammoth';
// Lazy import pdf-parse to avoid startup crash from test file loading

// OAuth2 credentials from environment
const DROPBOX_ACCESS_TOKEN = process.env.DROPBOX_ACCESS_TOKEN;
const DROPBOX_REFRESH_TOKEN = process.env.DROPBOX_REFRESH_TOKEN;
const DROPBOX_APP_KEY = process.env.DROPBOX_APP_KEY;
const DROPBOX_APP_SECRET = process.env.DROPBOX_APP_SECRET;

// Team configuration
const DROPBOX_TEAM_MEMBER_ID = process.env.DROPBOX_TEAM_MEMBER_ID;
const DROPBOX_NAMESPACE_ID = process.env.DROPBOX_NAMESPACE_ID;

// Token refresh logic
let currentAccessToken = DROPBOX_ACCESS_TOKEN;
let tokenExpiry = 0; // Start expired to force refresh on first use

/**
 * Refresh access token using refresh token
 * @returns {Promise<string>} New access token
 */
async function refreshAccessToken() {
  if (!DROPBOX_REFRESH_TOKEN || !DROPBOX_APP_KEY || !DROPBOX_APP_SECRET) {
    throw new Error('Dropbox refresh token or app credentials not configured');
  }

  console.log('🔄 Refreshing Dropbox access token...');

  const response = await fetch('https://api.dropbox.com/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: DROPBOX_REFRESH_TOKEN,
      client_id: DROPBOX_APP_KEY,
      client_secret: DROPBOX_APP_SECRET
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to refresh Dropbox token: ${error}`);
  }

  const data = await response.json();
  currentAccessToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in * 1000);

  console.log('✓ Dropbox access token refreshed');
  return currentAccessToken;
}

/**
 * Get valid access token (refresh if needed)
 * @returns {Promise<string>} Valid access token
 */
async function getAccessToken() {
  // If token expires in less than 5 minutes, refresh it
  if (Date.now() > tokenExpiry - 300000) {
    return await refreshAccessToken();
  }
  return currentAccessToken;
}

/**
 * Build request headers for Dropbox API
 * @param {Object} options - Optional headers
 * @returns {Promise<Object>} Headers object
 */
async function getDropboxHeaders(options = {}) {
  const token = await getAccessToken();

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...options
  };

  // Add team/namespace headers if configured
  if (DROPBOX_NAMESPACE_ID) {
    headers['Dropbox-API-Path-Root'] = JSON.stringify({
      ".tag": "namespace_id",
      "namespace_id": DROPBOX_NAMESPACE_ID
    });
  }

  if (DROPBOX_TEAM_MEMBER_ID) {
    headers['Dropbox-API-Select-User'] = DROPBOX_TEAM_MEMBER_ID;
  }

  return headers;
}

/**
 * List files in a Dropbox folder (with recursive option)
 * @param {string} path - Folder path (e.g., "/Oracle KB" or "" for root)
 * @param {boolean} recursive - Whether to list files recursively
 * @param {number} limit - Maximum number of results (for pagination)
 * @returns {Promise<Object>} List of files with metadata
 */
export async function listDropboxFolder(path = "", recursive = false, limit = 1000) {
  try {
    console.log(`📂 Listing Dropbox folder: ${path || '(root)'} (recursive: ${recursive})`);

    const headers = await getDropboxHeaders();

    const response = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        path: path || "",
        recursive: recursive,
        limit: limit,
        include_deleted: false,
        include_mounted_folders: true
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Dropbox API error: ${error.error_summary || response.statusText}`);
    }

    const data = await response.json();

    // Handle pagination if there are more results
    let allEntries = data.entries;
    let cursor = data.cursor;
    let hasMore = data.has_more;

    while (hasMore) {
      const continueResponse = await fetch('https://api.dropboxapi.com/2/files/list_folder/continue', {
        method: 'POST',
        headers,
        body: JSON.stringify({ cursor })
      });

      if (!continueResponse.ok) {
        const error = await continueResponse.json();
        throw new Error(`Dropbox pagination error: ${error.error_summary || continueResponse.statusText}`);
      }

      const continueData = await continueResponse.json();
      allEntries = allEntries.concat(continueData.entries);
      cursor = continueData.cursor;
      hasMore = continueData.has_more;
    }

    // Filter out folders, keep only files
    const files = allEntries.filter(entry => entry['.tag'] === 'file');

    console.log(`✓ Dropbox folder list: found ${files.length} files`);

    return {
      success: true,
      count: files.length,
      files: files.map(file => ({
        id: file.id,
        name: file.name,
        path: file.path_display,
        size: file.size,
        modified: file.server_modified,
        contentHash: file.content_hash
      }))
    };
  } catch (error) {
    console.error('Dropbox list folder error:', error.message);
    return {
      success: false,
      error: error.message,
      files: []
    };
  }
}

/**
 * Search Dropbox for files
 * @param {string} query - Search query
 * @param {string} path - Optional: Limit search to specific folder path
 * @param {number} maxResults - Maximum number of results
 * @returns {Promise<Object>} Search results
 */
export async function searchDropbox(query, path = "", maxResults = 10) {
  try {
    console.log(`🔍 Searching Dropbox for: "${query}"${path ? ` in ${path}` : ''}`);

    const headers = await getDropboxHeaders();

    const searchOptions = {
      filename_only: false,
      max_results: maxResults
    };

    if (path) {
      searchOptions.path = path;
    }

    const response = await fetch('https://api.dropboxapi.com/2/files/search_v2', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query: query,
        options: searchOptions
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Dropbox search error: ${error.error_summary || response.statusText}`);
    }

    const data = await response.json();
    const matches = data.matches || [];

    console.log(`✓ Dropbox search: found ${matches.length} results`);

    return {
      success: true,
      count: matches.length,
      files: matches
        .filter(match => match.metadata.metadata['.tag'] === 'file')
        .map(match => {
          const file = match.metadata.metadata;
          return {
            id: file.id,
            name: file.name,
            path: file.path_display,
            size: file.size,
            modified: file.server_modified,
            contentHash: file.content_hash
          };
        })
    };
  } catch (error) {
    console.error('Dropbox search error:', error.message);
    return {
      success: false,
      error: error.message,
      files: []
    };
  }
}

/**
 * Download file content from Dropbox
 * @param {string} path - File path in Dropbox
 * @returns {Promise<Buffer>} File content as Buffer
 */
async function downloadDropboxFile(path) {
  const token = await getAccessToken();

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Dropbox-API-Arg': JSON.stringify({ path })
  };

  // Add team/namespace headers if configured
  if (DROPBOX_NAMESPACE_ID) {
    headers['Dropbox-API-Path-Root'] = JSON.stringify({
      ".tag": "namespace_id",
      "namespace_id": DROPBOX_NAMESPACE_ID
    });
  }

  if (DROPBOX_TEAM_MEMBER_ID) {
    headers['Dropbox-API-Select-User'] = DROPBOX_TEAM_MEMBER_ID;
  }

  const response = await fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to download file: ${error}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

/**
 * Extract text from PDF buffer
 * @param {Buffer} buffer - PDF file buffer
 * @returns {Promise<string>} Extracted text
 */
async function extractTextFromPDF(buffer) {
  try {
    // Lazy load pdf-parse to avoid startup crash
    const { PDFParse, VerbosityLevel } = await import('pdf-parse');
    const parser = new PDFParse({ verbosity: VerbosityLevel.ERRORS });
    await parser.load(buffer);
    const text = await parser.getText();
    return text;
  } catch (error) {
    console.error('PDF extraction error:', error.message);
    return '[Error extracting PDF text]';
  }
}

/**
 * Extract text from DOCX buffer
 * @param {Buffer} buffer - DOCX file buffer
 * @returns {Promise<string>} Extracted text
 */
async function extractTextFromDOCX(buffer) {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  } catch (error) {
    console.error('DOCX extraction error:', error.message);
    return '[Error extracting DOCX text]';
  }
}

/**
 * Read Dropbox file content with text extraction
 * @param {string} path - File path in Dropbox
 * @returns {Promise<Object>} File content and metadata
 */
export async function readDropboxFile(path) {
  try {
    console.log(`📄 Reading Dropbox file: ${path}`);

    // Download the file
    const buffer = await downloadDropboxFile(path);

    // Determine file type from extension
    const ext = path.toLowerCase().split('.').pop();
    let content = '';
    let fileType = 'unknown';

    if (ext === 'pdf') {
      fileType = 'pdf';
      content = await extractTextFromPDF(buffer);
    } else if (ext === 'docx') {
      fileType = 'docx';
      content = await extractTextFromDOCX(buffer);
    } else if (ext === 'txt' || ext === 'md' || ext === 'csv') {
      fileType = 'text';
      content = buffer.toString('utf-8');
    } else if (ext === 'doc') {
      // Legacy .doc files not supported by mammoth
      content = '[Legacy .doc file format not supported. Please convert to .docx]';
      fileType = 'doc';
    } else {
      content = `[Unsupported file type: .${ext}]`;
      fileType = ext;
    }

    // Limit content length to avoid token overload
    const MAX_LENGTH = 50000; // ~50K characters
    const truncated = content.length > MAX_LENGTH;
    if (truncated) {
      content = content.substring(0, MAX_LENGTH) + '\n\n[Content truncated...]';
      console.log(`⚠️  File content truncated from ${content.length} to ${MAX_LENGTH} characters`);
    }

    console.log(`✓ Dropbox file read: ${path.split('/').pop()} (${content.length} chars)`);

    return {
      success: true,
      file: {
        path,
        name: path.split('/').pop(),
        type: fileType,
        size: buffer.length
      },
      content,
      truncated
    };
  } catch (error) {
    console.error('Dropbox read file error:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get Dropbox account/team information
 * Useful for getting namespace ID if not configured
 * @returns {Promise<Object>} Account information
 */
export async function getDropboxAccountInfo() {
  try {
    const headers = await getDropboxHeaders();

    const response = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
      method: 'POST',
      headers,
      body: 'null'
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Dropbox account info error: ${error.error_summary || response.statusText}`);
    }

    const data = await response.json();

    return {
      success: true,
      account: {
        accountId: data.account_id,
        email: data.email,
        name: data.name?.display_name || 'Unknown',
        rootNamespaceId: data.root_info?.root_namespace_id,
        homeNamespaceId: data.root_info?.home_namespace_id
      }
    };
  } catch (error) {
    console.error('Dropbox account info error:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}
