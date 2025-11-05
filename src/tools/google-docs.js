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
 * Brand colors (Granted Consulting)
 */
const BRAND_COLORS = {
  // Dark blue for headers (RGB: 0, 71, 171)
  HEADER_BLUE: {
    rgbColor: {
      red: 0,
      green: 0.278,  // 71/255
      blue: 0.671    // 171/255
    }
  }
};

/**
 * Document styling constants
 */
const STYLES = {
  BODY_FONT: 'Arial',
  BODY_SIZE: 11,
  HEADING_SIZE: 14,
  TITLE_SIZE: 18,
  MARGINS: {
    top: 72,    // 1 inch = 72 points
    bottom: 72,
    left: 72,
    right: 72
  }
};

/**
 * Convert markdown content to Google Docs requests with Granted Consulting branding
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

    // Section Header (## ) - Blue, bold, larger (like template)
    if (line.startsWith('## ')) {
      const text = line.substring(3) + '\n';
      const startIndex = currentIndex;

      requests.push({
        insertText: {
          location: { index: currentIndex },
          text: text
        }
      });

      // Make it blue, bold, and larger
      requests.push({
        updateTextStyle: {
          range: {
            startIndex: startIndex,
            endIndex: startIndex + text.length - 1
          },
          textStyle: {
            bold: true,
            fontSize: {
              magnitude: STYLES.HEADING_SIZE,
              unit: 'PT'
            },
            foregroundColor: {
              color: BRAND_COLORS.HEADER_BLUE
            }
          },
          fields: 'bold,fontSize,foregroundColor'
        }
      });

      // Add spacing after header
      requests.push({
        updateParagraphStyle: {
          range: {
            startIndex: startIndex,
            endIndex: startIndex + text.length
          },
          paragraphStyle: {
            spaceAbove: {
              magnitude: 12,
              unit: 'PT'
            },
            spaceBelow: {
              magnitude: 6,
              unit: 'PT'
            }
          },
          fields: 'spaceAbove,spaceBelow'
        }
      });

      currentIndex += text.length;
    }
    // Subsection (### ) - Bold, regular size
    else if (line.startsWith('### ')) {
      const text = line.substring(4) + '\n';
      const startIndex = currentIndex;

      requests.push({
        insertText: {
          location: { index: currentIndex },
          text: text
        }
      });

      requests.push({
        updateTextStyle: {
          range: {
            startIndex: startIndex,
            endIndex: startIndex + text.length - 1
          },
          textStyle: {
            bold: true,
            fontSize: {
              magnitude: 12,
              unit: 'PT'
            }
          },
          fields: 'bold,fontSize'
        }
      });

      currentIndex += text.length;
    }
    // Bullet list (- )
    else if (line.trim().startsWith('- ')) {
      const text = line.trim().substring(2) + '\n';
      const startIndex = currentIndex;

      requests.push({
        insertText: {
          location: { index: currentIndex },
          text: text
        }
      });

      requests.push({
        createParagraphBullets: {
          range: {
            startIndex: startIndex,
            endIndex: startIndex + text.length - 1
          },
          bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE'
        }
      });

      currentIndex += text.length;
    }
    // Regular text with inline formatting
    else {
      const text = line + '\n';
      let processedText = text;
      const formatRanges = [];

      // Find all **bold** matches
      const boldRegex = /\*\*([^*]+)\*\*/g;
      let match;
      while ((match = boldRegex.exec(text)) !== null) {
        formatRanges.push({
          type: 'bold',
          start: match.index,
          end: match.index + match[0].length,
          text: match[1],
          markupLength: 4  // ** at start and end
        });
      }

      // Find all *italic* matches (but not **)
      const italicRegex = /(?<!\*)\*(?!\*)([^*]+)\*(?!\*)/g;
      while ((match = italicRegex.exec(text)) !== null) {
        formatRanges.push({
          type: 'italic',
          start: match.index,
          end: match.index + match[0].length,
          text: match[1],
          markupLength: 2  // * at start and end
        });
      }

      // Remove markdown syntax
      processedText = text
        .replace(/\*\*([^*]+)\*\*/g, '$1')  // Remove **bold**
        .replace(/(?<!\*)\*(?!\*)([^*]+)\*(?!\*)/g, '$1');  // Remove *italic*

      // Insert the processed text
      requests.push({
        insertText: {
          location: { index: currentIndex },
          text: processedText
        }
      });

      // Apply formatting
      let offset = 0;
      for (const range of formatRanges.sort((a, b) => a.start - b.start)) {
        const adjustedStart = currentIndex + range.start - offset;
        const adjustedEnd = adjustedStart + range.text.length;

        if (range.type === 'bold') {
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
        } else if (range.type === 'italic') {
          requests.push({
            updateTextStyle: {
              range: {
                startIndex: adjustedStart,
                endIndex: adjustedEnd
              },
              textStyle: {
                italic: true
              },
              fields: 'italic'
            }
          });
        }

        offset += range.markupLength;
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
 * Upload logo image to Google Drive and cache it
 * @param {Object} driveClient - Google Drive API client
 * @param {string} logoPath - Path to logo file on local system
 * @returns {Promise<string>} Google Drive file ID
 */
async function uploadLogo(driveClient, logoPath) {
  try {
    // Check if logo already exists in Drive
    const searchResponse = await driveClient.files.list({
      q: "name='granted-consulting-logo.png' and trashed=false",
      fields: 'files(id, name)',
      spaces: 'drive'
    });

    if (searchResponse.data.files && searchResponse.data.files.length > 0) {
      const fileId = searchResponse.data.files[0].id;
      console.log(`   Using existing logo from Drive`);

      // Ensure the existing logo has public access
      try {
        await driveClient.permissions.create({
          fileId: fileId,
          requestBody: {
            role: 'reader',
            type: 'anyone'
          }
        });
        console.log(`   Logo permissions verified/updated`);
      } catch (err) {
        // Permission might already exist, that's ok
        console.log(`   Logo permissions already set`);
      }

      return fileId;
    }

    // Upload new logo
    const fs = await import('fs');
    const path = await import('path');

    const fileExtension = path.default.extname(logoPath).toLowerCase();
    const mimeType = fileExtension === '.png' ? 'image/png' : 'image/jpeg';

    console.log(`   Uploading logo to Drive...`);
    const fileMetadata = {
      name: 'granted-consulting-logo.png',
      mimeType: mimeType
    };

    const media = {
      mimeType: mimeType,
      body: fs.default.createReadStream(logoPath)
    };

    const file = await driveClient.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: 'id'
    });

    const fileId = file.data.id;
    console.log(`   Logo uploaded with ID: ${fileId}`);

    // Make the logo publicly accessible (required for insertInlineImage)
    await driveClient.permissions.create({
      fileId: fileId,
      requestBody: {
        role: 'reader',
        type: 'anyone'
      }
    });
    console.log(`   Logo set to public access`);

    return fileId;
  } catch (error) {
    console.error(`   Failed to upload logo:`, error.message);
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
 * @param {string} logoPath - Optional path to logo image file
 * @returns {Promise<Object>} Result with document link
 */
export async function createGoogleDoc(title, content, folderName = null, userId = null, logoPath = null) {
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

    // Step 1: Add Granted Consulting header (logo or text) and title
    let headerLength = 0;
    const headerRequests = [];

    if (logoPath) {
      // Upload logo and insert as image
      const logoFileId = await uploadLogo(driveClient, logoPath);

      if (logoFileId) {
        // Insert newline for the logo
        headerRequests.push({
          insertText: {
            location: { index: 1 },
            text: '\n\n'
          }
        });

        // Insert logo image at the beginning
        headerRequests.push({
          insertInlineImage: {
            location: { index: 1 },
            uri: `https://drive.google.com/uc?export=view&id=${logoFileId}`,
            objectSize: {
              height: {
                magnitude: 60,
                unit: 'PT'
              },
              width: {
                magnitude: 240,
                unit: 'PT'
              }
            }
          }
        });

        // Right-align the logo paragraph
        headerRequests.push({
          updateParagraphStyle: {
            range: {
              startIndex: 1,
              endIndex: 3
            },
            paragraphStyle: {
              alignment: 'END'  // Right-align
            },
            fields: 'alignment'
          }
        });

        headerLength = 3; // 1 char for image + 2 newlines
        console.log(`   Logo inserted`);
      } else {
        // Fallback to text header if logo upload failed
        logoPath = null;
      }
    }

    if (!logoPath) {
      // Use text-based header
      headerRequests.push(
        // Insert header text "GRANTED CONSULTING" at top
        {
          insertText: {
            location: { index: 1 },
            text: 'GRANTED CONSULTING\n\n'
          }
        },
        // Style the header (gray, 14pt, right-aligned)
        {
          updateTextStyle: {
            range: {
              startIndex: 1,
              endIndex: 19  // Length of "GRANTED CONSULTING"
            },
            textStyle: {
              fontSize: {
                magnitude: 14,
                unit: 'PT'
              },
              foregroundColor: {
                color: {
                  rgbColor: {
                    red: 0.4,
                    green: 0.4,
                    blue: 0.4
                  }
                }
              },
              weightedFontFamily: {
                fontFamily: STYLES.BODY_FONT
              }
            },
            fields: 'fontSize,foregroundColor,weightedFontFamily'
          }
        },
        // Right-align the header
        {
          updateParagraphStyle: {
            range: {
              startIndex: 1,
              endIndex: 20
            },
            paragraphStyle: {
              alignment: 'END'  // Right-align
            },
            fields: 'alignment'
          }
        }
      );
      headerLength = 21; // "GRANTED CONSULTING\n\n"
    }

    // Add title after header
    const titleStartIndex = headerLength + 1;
    headerRequests.push(
      // Insert title
      {
        insertText: {
          location: { index: titleStartIndex },
          text: title + '\n\n'
        }
      },
      // Style the title (bold, larger, black)
      {
        updateTextStyle: {
          range: {
            startIndex: titleStartIndex,
            endIndex: titleStartIndex + title.length
          },
          textStyle: {
            bold: true,
            fontSize: {
              magnitude: STYLES.TITLE_SIZE,
              unit: 'PT'
            },
            weightedFontFamily: {
              fontFamily: STYLES.BODY_FONT
            }
          },
          fields: 'bold,fontSize,weightedFontFamily'
        }
      }
    );

    await docsClient.documents.batchUpdate({
      documentId: documentId,
      requestBody: {
        requests: headerRequests
      }
    });
    console.log(`   Header and title added`);

    // Step 2: Convert markdown to Google Docs format and insert content
    const contentStartIndex = headerLength + title.length + 2; // After header + title + 2 newlines
    const requests = markdownToDocsRequests(content);

    // Adjust all indices in requests to account for header and title
    const adjustedRequests = requests.map(req => {
      if (req.insertText) {
        return {
          ...req,
          insertText: {
            ...req.insertText,
            location: { index: req.insertText.location.index + contentStartIndex - 1 }
          }
        };
      } else if (req.updateTextStyle) {
        return {
          ...req,
          updateTextStyle: {
            ...req.updateTextStyle,
            range: {
              startIndex: req.updateTextStyle.range.startIndex + contentStartIndex - 1,
              endIndex: req.updateTextStyle.range.endIndex + contentStartIndex - 1
            }
          }
        };
      } else if (req.updateParagraphStyle) {
        return {
          ...req,
          updateParagraphStyle: {
            ...req.updateParagraphStyle,
            range: {
              startIndex: req.updateParagraphStyle.range.startIndex + contentStartIndex - 1,
              endIndex: req.updateParagraphStyle.range.endIndex + contentStartIndex - 1
            }
          }
        };
      } else if (req.createParagraphBullets) {
        return {
          ...req,
          createParagraphBullets: {
            ...req.createParagraphBullets,
            range: {
              startIndex: req.createParagraphBullets.range.startIndex + contentStartIndex - 1,
              endIndex: req.createParagraphBullets.range.endIndex + contentStartIndex - 1
            }
          }
        };
      }
      return req;
    });

    if (adjustedRequests.length > 0) {
      await docsClient.documents.batchUpdate({
        documentId: documentId,
        requestBody: {
          requests: adjustedRequests
        }
      });
      console.log(`   Content formatted and inserted`);
    }

    // Step 3: Set document-wide styles (margins, default font, line spacing)
    await docsClient.documents.batchUpdate({
      documentId: documentId,
      requestBody: {
        requests: [
          {
            updateDocumentStyle: {
              documentStyle: {
                marginTop: {
                  magnitude: STYLES.MARGINS.top,
                  unit: 'PT'
                },
                marginBottom: {
                  magnitude: STYLES.MARGINS.bottom,
                  unit: 'PT'
                },
                marginLeft: {
                  magnitude: STYLES.MARGINS.left,
                  unit: 'PT'
                },
                marginRight: {
                  magnitude: STYLES.MARGINS.right,
                  unit: 'PT'
                }
              },
              fields: 'marginTop,marginBottom,marginLeft,marginRight'
            }
          }
        ]
      }
    });
    console.log(`   Document styles applied`);


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
