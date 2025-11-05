/**
 * Google Docs Tool
 * Create formatted Google Docs with markdown content
 */

import { google } from 'googleapis';
import { config } from 'dotenv';

config();

/**
 * Get user's OAuth tokens from database
 * @param {number} userId - User ID
 * @returns {Promise<Object>} OAuth tokens
 */
async function getUserOAuthTokens(userId) {
  const { query } = await import('../database/connection.js');
  const result = await query(
    'SELECT google_access_token, google_refresh_token, google_token_expiry FROM users WHERE id = $1',
    [userId]
  );

  if (result.rows.length === 0) {
    throw new Error('User not found');
  }

  const user = result.rows[0];
  if (!user.google_refresh_token) {
    throw new Error('User has not authorized Google Drive access. Please log out and log back in to grant permissions.');
  }

  return {
    access_token: user.google_access_token,
    refresh_token: user.google_refresh_token,
    expiry_date: user.google_token_expiry ? new Date(user.google_token_expiry).getTime() : null
  };
}

/**
 * Save refreshed OAuth tokens to database
 * @param {number} userId - User ID
 * @param {Object} tokens - New OAuth tokens
 */
async function saveUserOAuthTokens(userId, tokens) {
  const { query } = await import('../database/connection.js');
  const tokenExpiry = tokens.expiry_date ? new Date(tokens.expiry_date) : null;

  await query(
    'UPDATE users SET google_access_token = $1, google_token_expiry = $2 WHERE id = $3',
    [tokens.access_token, tokenExpiry, userId]
  );
}

/**
 * Get authenticated OAuth2 client for user
 * Automatically refreshes tokens if expired
 * @param {number} userId - User ID
 * @returns {Promise<Object>} Authenticated OAuth2 client
 */
async function getUserOAuth2Client(userId) {
  const tokens = await getUserOAuthTokens(userId);

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'https://grant-card-assistant-production.up.railway.app/api/auth-callback'
  );

  oauth2Client.setCredentials(tokens);

  // Set up automatic token refresh
  oauth2Client.on('tokens', (newTokens) => {
    console.log('   OAuth tokens refreshed automatically');
    if (newTokens.refresh_token) {
      tokens.refresh_token = newTokens.refresh_token;
    }
    tokens.access_token = newTokens.access_token;
    tokens.expiry_date = newTokens.expiry_date;

    // Save refreshed tokens to database
    saveUserOAuthTokens(userId, tokens).catch(err => {
      console.error('   Failed to save refreshed tokens:', err.message);
    });
  });

  return oauth2Client;
}

/**
 * Get authenticated Google Docs client using user's OAuth credentials
 * @param {number} userId - User ID
 * @returns {Promise<Object>} Google Docs API client
 */
async function getDocsClient(userId) {
  const auth = await getUserOAuth2Client(userId);
  return google.docs({ version: 'v1', auth });
}

/**
 * Get authenticated Google Drive client using user's OAuth credentials
 * @param {number} userId - User ID
 * @returns {Promise<Object>} Google Drive API client
 */
async function getDriveClient(userId) {
  const auth = await getUserOAuth2Client(userId);
  return google.drive({ version: 'v3', auth });
}

/**
 * Convert markdown content to Google Docs requests
 * @param {string} content - Markdown formatted content
 * @returns {Array} Array of Google Docs API requests
 */
function markdownToDocsRequests(content) {
  const requests = [];
  let currentIndex = 1; // Google Docs index starts at 1

  // Split content into lines
  const lines = content.split('\n');

  for (const line of lines) {
    if (!line.trim()) {
      // Empty line - add a newline
      requests.push({
        insertText: {
          location: { index: currentIndex },
          text: '\n'
        }
      });
      currentIndex += 1;
      continue;
    }

    // Heading 1 (##)
    if (line.startsWith('## ')) {
      const text = line.substring(3) + '\n';
      requests.push({
        insertText: {
          location: { index: currentIndex },
          text: text
        }
      });

      requests.push({
        updateParagraphStyle: {
          range: {
            startIndex: currentIndex,
            endIndex: currentIndex + text.length - 1
          },
          paragraphStyle: {
            namedStyleType: 'HEADING_1'
          },
          fields: 'namedStyleType'
        }
      });

      currentIndex += text.length;
    }
    // Heading 2 (###)
    else if (line.startsWith('### ')) {
      const text = line.substring(4) + '\n';
      requests.push({
        insertText: {
          location: { index: currentIndex },
          text: text
        }
      });

      requests.push({
        updateParagraphStyle: {
          range: {
            startIndex: currentIndex,
            endIndex: currentIndex + text.length - 1
          },
          paragraphStyle: {
            namedStyleType: 'HEADING_2'
          },
          fields: 'namedStyleType'
        }
      });

      currentIndex += text.length;
    }
    // Bullet list (- )
    else if (line.trim().startsWith('- ')) {
      const text = line.trim().substring(2) + '\n';
      requests.push({
        insertText: {
          location: { index: currentIndex },
          text: text
        }
      });

      requests.push({
        createParagraphBullets: {
          range: {
            startIndex: currentIndex,
            endIndex: currentIndex + text.length - 1
          },
          bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE'
        }
      });

      currentIndex += text.length;
    }
    // Regular text
    else {
      // Handle bold (**text**)
      const text = line + '\n';
      let processedText = text;
      const boldMatches = [];
      let match;
      const boldRegex = /\*\*([^*]+)\*\*/g;

      while ((match = boldRegex.exec(text)) !== null) {
        boldMatches.push({
          start: match.index,
          end: match.index + match[0].length,
          text: match[1]
        });
      }

      // Remove markdown syntax
      processedText = text.replace(/\*\*([^*]+)\*\*/g, '$1');

      requests.push({
        insertText: {
          location: { index: currentIndex },
          text: processedText
        }
      });

      // Apply bold formatting
      for (const bold of boldMatches) {
        const adjustedStart = currentIndex + bold.start - (boldMatches.indexOf(bold) * 4);
        const adjustedEnd = adjustedStart + bold.text.length;

        requests.push({
          updateTextStyle: {
            range: {
              startIndex: adjustedStart,
              endIndex: adjustedEnd
            },
            textStyle: {
              bold: true
            },
            fields: 'bold'
          }
        });
      }

      currentIndex += processedText.length;
    }
  }

  return requests;
}

/**
 * Find or create a folder in Google Drive
 * @param {Object} driveClient - Google Drive API client
 * @param {string} folderName - Name of the folder
 * @returns {Promise<string>} Folder ID
 */
async function findOrCreateFolder(driveClient, folderName) {
  try {
    // Search for existing folder
    const response = await driveClient.files.list({
      q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id, name)',
      spaces: 'drive'
    });

    if (response.data.files && response.data.files.length > 0) {
      console.log(`   Found existing folder: ${folderName}`);
      return response.data.files[0].id;
    }

    // Create new folder
    console.log(`   Creating new folder: ${folderName}`);
    const folder = await driveClient.files.create({
      requestBody: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder'
      },
      fields: 'id'
    });

    return folder.data.id;
  } catch (error) {
    console.error(`   Error with folder ${folderName}:`, error.message);
    return null;
  }
}

/**
 * Create a Google Doc with formatted content
 * Uses user's OAuth credentials to create documents in their Google Drive
 * @param {string} title - Document title
 * @param {string} content - Markdown formatted content
 * @param {string} folderName - Optional folder name to organize the document
 * @param {number} userId - User ID from database
 * @returns {Promise<Object>} Result with document link
 */
export async function createGoogleDoc(title, content, folderName = null, userId = null) {
  try {
    console.log(`📄 Creating Google Doc: ${title}`);

    if (!userId) {
      throw new Error('userId is required for Google Docs creation');
    }

    const docsClient = await getDocsClient(userId);
    const driveClient = await getDriveClient(userId);

    // Find or create folder first if specified
    let folderId = null;
    if (folderName) {
      folderId = await findOrCreateFolder(driveClient, folderName);
      if (!folderId) {
        throw new Error(`Failed to access or create folder: ${folderName}`);
      }
    }

    // Create document directly in the folder using Drive API
    const fileMetadata = {
      name: title,
      mimeType: 'application/vnd.google-apps.document',
      ...(folderId && { parents: [folderId] })
    };

    const file = await driveClient.files.create({
      requestBody: fileMetadata,
      fields: 'id'
    });

    const documentId = file.data.id;
    console.log(`   Document created with ID: ${documentId}${folderId ? ' in folder' : ''}`);

    // Convert markdown to Google Docs format and insert content
    const requests = markdownToDocsRequests(content);

    if (requests.length > 0) {
      await docsClient.documents.batchUpdate({
        documentId: documentId,
        requestBody: {
          requests: requests
        }
      });
      console.log(`   Content formatted and inserted`);
    }

    // Make the document accessible to anyone with the link
    await driveClient.permissions.create({
      fileId: documentId,
      requestBody: {
        role: 'writer',
        type: 'anyone'
      }
    });
    console.log(`   Document sharing enabled`);

    const docUrl = `https://docs.google.com/document/d/${documentId}/edit`;

    return {
      success: true,
      documentId: documentId,
      url: docUrl,
      title: title,
      message: `✅ Successfully created Google Doc: "${title}"`
    };

  } catch (error) {
    console.error(`❌ Error creating Google Doc:`, error);
    return {
      success: false,
      error: error.message
    };
  }
}
