/**
 * Google Docs Tool
 * Create formatted Google Docs with markdown content
 */

import { google } from 'googleapis';
import { config } from 'dotenv';

config();

// Parse Google Service Account credentials
let serviceAccountKey;
try {
  serviceAccountKey = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
} catch (error) {
  console.error('Failed to parse GOOGLE_SERVICE_ACCOUNT_KEY:', error.message);
}

/**
 * Get authenticated Google Docs client (uses service account directly)
 * @returns {Object} Google Docs API client
 */
async function getDocsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: serviceAccountKey,
    scopes: [
      'https://www.googleapis.com/auth/documents',
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/drive.file'
    ]
  });

  return google.docs({ version: 'v1', auth });
}

/**
 * Get authenticated Google Drive client (uses service account directly)
 * @returns {Object} Google Drive API client
 */
async function getDriveClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: serviceAccountKey,
    scopes: [
      'https://www.googleapis.com/auth/documents',
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/drive.file'
    ]
  });

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
 * Documents are created in the service account's Drive and shared publicly with "anyone with the link"
 * @param {string} title - Document title
 * @param {string} content - Markdown formatted content
 * @param {string} folderName - Optional folder name to organize the document
 * @param {string} userEmail - User email (not used, kept for API compatibility)
 * @returns {Promise<Object>} Result with document link
 */
export async function createGoogleDoc(title, content, folderName = null, userEmail = null) {
  try {
    console.log(`📄 Creating Google Doc: ${title}`);

    const docsClient = await getDocsClient();
    const driveClient = await getDriveClient();

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
