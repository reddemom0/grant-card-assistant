/**
 * Google Docs Construction Engine
 *
 * Converts template configurations into properly formatted Google Docs
 * using the Google Docs API v1 batchUpdate method.
 *
 * Key patterns:
 * - Create empty document first
 * - Build all content/formatting requests
 * - Execute in single batchUpdate call
 * - Insert content in REVERSE order (bottom to top) to maintain indexes
 */

import { google } from 'googleapis';

/**
 * Create a Google Doc from a template configuration
 * @param {string} title - Document title
 * @param {number} userId - User ID for OAuth
 * @param {Object} template - Template configuration from doc-templates
 * @param {Object} data - Data to replace placeholders
 * @param {string} parentFolderId - Optional parent folder ID
 * @returns {Object} Created document info
 */
export async function createGoogleDocFromTemplate(title, userId, template, data = {}, parentFolderId = null) {
  try {
    console.log(`Creating Google Doc: "${title}" for user ID: ${userId}`);

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

    // Create OAuth2 client
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );

    oauth2Client.setCredentials({
      access_token: user.google_access_token,
      refresh_token: user.google_refresh_token,
      expiry_date: user.google_token_expiry ? new Date(user.google_token_expiry).getTime() : null
    });

    // Create Docs and Drive API clients
    const docs = google.docs({ version: 'v1', auth: oauth2Client });
    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    // Step 1: Create empty document
    const doc = await docs.documents.create({
      requestBody: {
        title: title
      }
    });

    const documentId = doc.data.documentId;
    console.log(`✓ Created document with ID: ${documentId}`);

    // Step 2: Merge template data with defaults
    const mergedData = { ...template.defaultData, ...data };

    // Step 3: Build batchUpdate requests from template
    const { structureRequests, tablePopulationNeeded } = buildDocumentRequests(template, mergedData);

    // Step 4: Execute structure requests (text, formatting, table creation)
    if (structureRequests.length > 0) {
      await docs.documents.batchUpdate({
        documentId: documentId,
        requestBody: { requests: structureRequests }
      });
      console.log(`✓ Applied ${structureRequests.length} structure/formatting requests`);
    }

    // Step 5: If tables were created, retrieve document and populate cells
    if (tablePopulationNeeded) {
      // Get updated document with actual table indexes
      const updatedDoc = await docs.documents.get({
        documentId: documentId
      });

      // Build table cell population requests
      const cellRequests = buildTableCellRequests(updatedDoc.data, template, mergedData);

      if (cellRequests.length > 0) {
        await docs.documents.batchUpdate({
          documentId: documentId,
          requestBody: { requests: cellRequests }
        });
        console.log(`✓ Populated ${cellRequests.length / 2} table cells`);
      }
    }

    // Step 5: Move to parent folder if specified
    if (parentFolderId) {
      await drive.files.update({
        fileId: documentId,
        addParents: parentFolderId,
        fields: 'id, parents'
      });
      console.log(`✓ Moved document to folder: ${parentFolderId}`);
    }

    // Step 6: Get web view link
    const file = await drive.files.get({
      fileId: documentId,
      fields: 'webViewLink'
    });

    console.log(`✓ Google Doc created: ${title} (${documentId})`);

    return {
      success: true,
      documentId: documentId,
      title: title,
      url: file.data.webViewLink
    };

  } catch (error) {
    console.error('Error creating Google Doc:', error);
    throw error;
  }
}

/**
 * Build batchUpdate requests from template configuration
 * Processes sections in REVERSE order to maintain indexes
 */
function buildDocumentRequests(template, data) {
  const structureRequests = [];
  let tablePopulationNeeded = false;
  let currentIndex = 1; // Start after document title

  // Process sections in REVERSE order (bottom to top)
  const reversedSections = [...template.sections].reverse();

  for (const section of reversedSections) {
    const { requests, hasTable } = buildSectionRequests(section, data, currentIndex);
    structureRequests.push(...requests);

    if (hasTable) {
      tablePopulationNeeded = true;
    }
  }

  return { structureRequests, tablePopulationNeeded };
}

/**
 * Build table cell population requests after tables are created
 * This is phase 2 after retrieving the document with actual indexes
 */
function buildTableCellRequests(document, template, data) {
  const requests = [];

  // Find all tables in the document
  const tables = findTablesInDocument(document);

  // Match template sections with tables and populate
  let tableIndex = 0;
  for (const section of template.sections) {
    if (isTableSection(section.type)) {
      if (tableIndex < tables.length) {
        const table = tables[tableIndex];
        const cellRequests = populateTableCells(table, section, data);
        requests.push(...cellRequests);
        tableIndex++;
      }
    }
  }

  return requests;
}

/**
 * Find all tables in a document
 */
function findTablesInDocument(document) {
  const tables = [];

  function traverse(element) {
    if (element.table) {
      tables.push(element.table);
    }

    if (element.paragraph) {
      for (const elem of element.paragraph.elements || []) {
        if (elem.table) {
          tables.push(elem.table);
        }
      }
    }

    // Recursively traverse structural elements
    for (const child of element.content || []) {
      traverse(child);
    }
  }

  traverse(document.body);
  return tables;
}

/**
 * Check if section type is a table
 */
function isTableSection(type) {
  const tableSectionTypes = [
    'table',
    'field-row',
    'professional-grid',
    'weighted-criteria-table',
    'scoring-table',
    'score-summary-table'
  ];
  return tableSectionTypes.includes(type);
}

/**
 * Populate table cells with data
 */
function populateTableCells(table, section, data) {
  const requests = [];

  // Get table dimensions
  const rows = table.tableRows || [];
  const numRows = rows.length;

  // Populate based on section type
  if (section.type === 'weighted-criteria-table') {
    // Special handling for rubric tables
    requests.push(...populateWeightedCriteriaTable(rows, section, data));
  } else if (section.type === 'scoring-table') {
    requests.push(...populateScoringTable(rows, section, data));
  } else if (section.type === 'score-summary-table') {
    requests.push(...populateScoreSummaryTable(rows, section, data));
  } else {
    // Generic table population
    requests.push(...populateGenericTable(rows, section, data));
  }

  return requests;
}

/**
 * Populate weighted criteria table (for rubrics)
 */
function populateWeightedCriteriaTable(rows, section, data) {
  const requests = [];

  // Row 0: Headers
  if (rows.length > 0 && section.headers) {
    const headerRow = rows[0];
    for (let col = 0; col < section.headers.length && col < headerRow.tableCells.length; col++) {
      const cell = headerRow.tableCells[col];
      const cellStart = cell.startIndex;
      requests.push({
        insertText: {
          location: { index: cellStart + 1 },
          text: section.headers[col]
        }
      });
    }
  }

  // Data rows
  for (let i = 0; i < section.rows.length && i + 1 < rows.length; i++) {
    const rowData = section.rows[i];
    const tableRow = rows[i + 1];

    const cells = [
      replacePlaceholders(rowData.criterion || '', data),
      replacePlaceholders(rowData.indicators || '', data),
      String(rowData.weight || ''),
      replacePlaceholders(rowData.score || '0', data),
      rowData.weightedScore === 'FORMULA' ? '(calculated)' : replacePlaceholders(rowData.weightedScore || '', data),
      replacePlaceholders(rowData.notes || '', data)
    ];

    for (let col = 0; col < cells.length && col < tableRow.tableCells.length; col++) {
      const cell = tableRow.tableCells[col];
      const cellStart = cell.startIndex;
      requests.push({
        insertText: {
          location: { index: cellStart + 1 },
          text: cells[col]
        }
      });
    }
  }

  return requests;
}

/**
 * Populate scoring table
 */
function populateScoringTable(rows, section, data) {
  const requests = [];

  // Headers
  if (rows.length > 0 && section.headers) {
    const headerRow = rows[0];
    for (let col = 0; col < section.headers.length && col < headerRow.tableCells.length; col++) {
      const cell = headerRow.tableCells[col];
      requests.push({
        insertText: {
          location: { index: cell.startIndex + 1 },
          text: section.headers[col]
        }
      });
    }
  }

  // Data rows
  for (let i = 0; i < section.rows.length && i + 1 < rows.length; i++) {
    const rowData = section.rows[i];
    const tableRow = rows[i + 1];

    const cells = [
      rowData.score || '',
      replacePlaceholders(rowData.criteria || '', data),
      replacePlaceholders(rowData.tips || '', data)
    ].filter((_, idx) => idx < section.headers.length);

    for (let col = 0; col < cells.length && col < tableRow.tableCells.length; col++) {
      const cell = tableRow.tableCells[col];
      requests.push({
        insertText: {
          location: { index: cell.startIndex + 1 },
          text: cells[col]
        }
      });
    }
  }

  return requests;
}

/**
 * Populate score summary table
 */
function populateScoreSummaryTable(rows, section, data) {
  const requests = [];

  for (let i = 0; i < section.rows.length && i < rows.length; i++) {
    const rowData = section.rows[i];
    const tableRow = rows[i];

    const cells = [
      replacePlaceholders(rowData.label || '', data),
      replacePlaceholders(rowData.value || '', data),
      rowData.formula || ''
    ];

    for (let col = 0; col < cells.length && col < tableRow.tableCells.length; col++) {
      const cell = tableRow.tableCells[col];
      requests.push({
        insertText: {
          location: { index: cell.startIndex + 1 },
          text: cells[col]
        }
      });
    }
  }

  return requests;
}

/**
 * Populate generic table
 */
function populateGenericTable(rows, section, data) {
  const requests = [];

  // Headers
  if (rows.length > 0 && section.headers) {
    const headerRow = rows[0];
    for (let col = 0; col < section.headers.length && col < headerRow.tableCells.length; col++) {
      const cell = headerRow.tableCells[col];
      requests.push({
        insertText: {
          location: { index: cell.startIndex + 1 },
          text: section.headers[col]
        }
      });
    }
  }

  // Data rows
  if (section.rows) {
    for (let i = 0; i < section.rows.length && i + 1 < rows.length; i++) {
      const rowData = section.rows[i];
      const tableRow = rows[i + 1];

      // Convert row data to array if it's an object
      const cells = Array.isArray(rowData) ? rowData : Object.values(rowData);

      for (let col = 0; col < cells.length && col < tableRow.tableCells.length; col++) {
        const cell = tableRow.tableCells[col];
        const cellValue = replacePlaceholders(String(cells[col] || ''), data);
        requests.push({
          insertText: {
            location: { index: cell.startIndex + 1 },
            text: cellValue
          }
        });
      }
    }
  }

  return requests;
}

/**
 * Build requests for a single section based on its type
 */
function buildSectionRequests(section, data, index) {
  const requests = [];
  let hasTable = false;

  switch (section.type) {
    case 'title':
      requests.push(...buildTitleRequests(section, data, index));
      break;

    case 'header':
      requests.push(...buildHeaderRequests(section, data, index));
      break;

    case 'subheader':
      requests.push(...buildSubheaderRequests(section, data, index));
      break;

    case 'paragraph':
      requests.push(...buildParagraphRequests(section, data, index));
      break;

    case 'list':
    case 'numbered-questions':
    case 'checklist':
      requests.push(...buildListRequests(section, data, index));
      break;

    case 'table':
    case 'field-row':
    case 'professional-grid':
      requests.push(...buildTableRequests(section, data, index));
      hasTable = true;
      break;

    case 'weighted-criteria-table':
      requests.push(...buildWeightedCriteriaTableRequests(section, data, index));
      hasTable = true;
      break;

    case 'scoring-table':
      requests.push(...buildScoringTableRequests(section, data, index));
      hasTable = true;
      break;

    case 'score-summary-table':
      requests.push(...buildScoreSummaryTableRequests(section, data, index));
      hasTable = true;
      break;

    case 'info-box':
    case 'callout':
      requests.push(...buildCalloutRequests(section, data, index));
      break;

    case 'evaluation-summary':
      requests.push(...buildEvaluationSummaryRequests(section, data, index));
      break;

    case 'priority-scale':
      requests.push(...buildPriorityScaleRequests(section, data, index));
      break;

    default:
      console.warn(`Unknown section type: ${section.type}`);
  }

  return { requests, hasTable };
}

/**
 * Build title requests (large, bold, branded color)
 */
function buildTitleRequests(section, data, index) {
  const requests = [];
  const text = replacePlaceholders(section.text, data) + '\n\n';

  // Insert text
  requests.push({
    insertText: {
      location: { index },
      text: text
    }
  });

  // Apply title styling
  requests.push({
    updateParagraphStyle: {
      range: {
        startIndex: index,
        endIndex: index + text.length - 2
      },
      paragraphStyle: {
        namedStyleType: 'TITLE',
        alignment: 'CENTER'
      },
      fields: 'namedStyleType,alignment'
    }
  });

  // Apply text color (branded blue)
  if (section.style === 'title-branded') {
    requests.push({
      updateTextStyle: {
        range: {
          startIndex: index,
          endIndex: index + text.length - 2
        },
        textStyle: {
          foregroundColor: {
            color: {
              rgbColor: { red: 0, green: 0.28, blue: 0.67 } // #0047AB
            }
          },
          bold: true,
          fontSize: {
            magnitude: 24,
            unit: 'PT'
          }
        },
        fields: 'foregroundColor,bold,fontSize'
      }
    });
  }

  return requests;
}

/**
 * Build header requests (H1, H2, H3)
 */
function buildHeaderRequests(section, data, index) {
  const requests = [];
  const text = replacePlaceholders(section.text, data) + '\n\n';
  const level = section.level || 1;

  // Insert text
  requests.push({
    insertText: {
      location: { index },
      text: text
    }
  });

  // Apply header style
  const headerStyle = level === 1 ? 'HEADING_1' : level === 2 ? 'HEADING_2' : 'HEADING_3';

  requests.push({
    updateParagraphStyle: {
      range: {
        startIndex: index,
        endIndex: index + text.length - 2
      },
      paragraphStyle: {
        namedStyleType: headerStyle
      },
      fields: 'namedStyleType'
    }
  });

  // Apply branded color if specified
  if (section.style === 'header-branded') {
    requests.push({
      updateTextStyle: {
        range: {
          startIndex: index,
          endIndex: index + text.length - 2
        },
        textStyle: {
          foregroundColor: {
            color: {
              rgbColor: { red: 0, green: 0.28, blue: 0.67 } // #0047AB
            }
          }
        },
        fields: 'foregroundColor'
      }
    });
  }

  return requests;
}

/**
 * Build subheader requests
 */
function buildSubheaderRequests(section, data, index) {
  const requests = [];
  const text = replacePlaceholders(section.text, data) + '\n';

  // Insert text
  requests.push({
    insertText: {
      location: { index },
      text: text
    }
  });

  // Apply styling
  const textStyle = {
    bold: true,
    fontSize: {
      magnitude: 12,
      unit: 'PT'
    }
  };

  if (section.style === 'bold-blue' || section.style === 'subheader-branded') {
    textStyle.foregroundColor = {
      color: {
        rgbColor: { red: 0, green: 0.28, blue: 0.67 }
      }
    };
  }

  requests.push({
    updateTextStyle: {
      range: {
        startIndex: index,
        endIndex: index + text.length - 1
      },
      textStyle: textStyle,
      fields: Object.keys(textStyle).join(',')
    }
  });

  return requests;
}

/**
 * Build paragraph requests
 */
function buildParagraphRequests(section, data, index) {
  const requests = [];
  const text = replacePlaceholders(section.text, data) + '\n';

  // Insert text
  requests.push({
    insertText: {
      location: { index },
      text: text
    }
  });

  // Apply style if specified
  if (section.style === 'bold') {
    requests.push({
      updateTextStyle: {
        range: {
          startIndex: index,
          endIndex: index + text.length - 1
        },
        textStyle: {
          bold: true
        },
        fields: 'bold'
      }
    });
  } else if (section.style === 'bold-large') {
    requests.push({
      updateTextStyle: {
        range: {
          startIndex: index,
          endIndex: index + text.length - 1
        },
        textStyle: {
          bold: true,
          fontSize: {
            magnitude: 14,
            unit: 'PT'
          }
        },
        fields: 'bold,fontSize'
      }
    });
  }

  return requests;
}

/**
 * Build list requests (bulleted, numbered, or checkbox)
 */
function buildListRequests(section, data, index) {
  const requests = [];
  const items = Array.isArray(section.items) ? section.items :
                section.items.split('\n').filter(item => item.trim());

  // Process items with placeholder replacement
  const processedItems = items.map(item => replacePlaceholders(item, data));

  // Insert list items
  const listText = processedItems.map(item => `${item}\n`).join('');

  requests.push({
    insertText: {
      location: { index },
      text: listText + '\n\n'  // ← FIXED: Extra newline to break list continuity
    }
  });

  // Apply bullet formatting with valid Google Docs API preset names
  const glyphType = section.type === 'numbered-questions' ? 'NUMBERED_DECIMAL_ALPHA_ROMAN' :
                   section.type === 'checklist' ? 'BULLET_CHECKBOX' :
                   'BULLET_DISC_CIRCLE_SQUARE';

  requests.push({
    createParagraphBullets: {
      range: {
        startIndex: index,
        endIndex: index + listText.length  // Don't include the extra newline in bullet range
      },
      bulletPreset: glyphType
    }
  });

  return requests;
}

/**
 * Build table requests (basic tables, field rows, etc.)
 */
function buildTableRequests(section, data, index) {
  const requests = [];

  // Determine table dimensions
  const rows = section.rows?.length || 0;
  const cols = section.headers?.length || section.cols || 2;

  if (rows === 0) return requests;

  // Insert table (cells will be populated in phase 2)
  requests.push({
    insertTable: {
      location: { index },
      rows: rows + (section.headers ? 1 : 0),
      columns: cols
    }
  });

  return requests;
}

/**
 * Build weighted criteria table requests (for rubrics)
 */
function buildWeightedCriteriaTableRequests(section, data, index) {
  const requests = [];

  const rows = section.rows?.length || 0;
  const cols = section.headers?.length || 6;

  if (rows === 0) return requests;

  // Insert table structure (cells populated in phase 2)
  requests.push({
    insertTable: {
      location: { index },
      rows: rows + 1, // +1 for header row
      columns: cols
    }
  });

  return requests;
}

/**
 * Build scoring table requests
 */
function buildScoringTableRequests(section, data, index) {
  return buildTableRequests(section, data, index);
}

/**
 * Build score summary table requests
 */
function buildScoreSummaryTableRequests(section, data, index) {
  return buildTableRequests(section, data, index);
}

/**
 * Build callout/info-box requests (colored background boxes)
 */
function buildCalloutRequests(section, data, index) {
  const requests = [];
  const text = replacePlaceholders(section.text, data) + '\n\n';

  // Insert text
  requests.push({
    insertText: {
      location: { index },
      text: text
    }
  });

  // Apply background color based on style
  let bgColor = { red: 0.9, green: 0.9, blue: 1 }; // default light blue

  if (section.style === 'warning-red') {
    bgColor = { red: 1, green: 0.9, blue: 0.9 };
  } else if (section.style === 'yellow-highlight') {
    bgColor = { red: 1, green: 1, blue: 0.8 };
  }

  requests.push({
    updateParagraphStyle: {
      range: {
        startIndex: index,
        endIndex: index + text.length - 2
      },
      paragraphStyle: {
        shading: {
          backgroundColor: {
            color: {
              rgbColor: bgColor
            }
          }
        }
      },
      fields: 'shading'
    }
  });

  return requests;
}

/**
 * Build evaluation summary requests
 */
function buildEvaluationSummaryRequests(section, data, index) {
  const requests = [];

  // Build field rows
  for (const field of section.fields || []) {
    const label = replacePlaceholders(field.label, data);
    const value = replacePlaceholders(field.value, data);
    const text = `${label}: ${value}\n\n`;

    requests.push({
      insertText: {
        location: { index },
        text: text
      }
    });

    // Make label bold
    requests.push({
      updateTextStyle: {
        range: {
          startIndex: index,
          endIndex: index + label.length
        },
        textStyle: {
          bold: true
        },
        fields: 'bold'
      }
    });
  }

  return requests;
}

/**
 * Build priority scale requests
 */
function buildPriorityScaleRequests(section, data, index) {
  const requests = [];

  for (const item of section.items || []) {
    const text = `${item.rating}: ${item.range} - ${item.description}\n`;

    requests.push({
      insertText: {
        location: { index },
        text: text
      }
    });

    // Bold the rating
    requests.push({
      updateTextStyle: {
        range: {
          startIndex: index,
          endIndex: index + item.rating.length
        },
        textStyle: {
          bold: true
        },
        fields: 'bold'
      }
    });
  }

  requests.push({
    insertText: {
      location: { index },
      text: '\n'
    }
  });

  return requests;
}

/**
 * Replace placeholders in text with actual data
 */
function replacePlaceholders(text, data) {
  if (!text) return '';

  let result = text;

  // Replace {{placeholder}} with data values
  const placeholderRegex = /\{\{([^}]+)\}\}/g;
  result = result.replace(placeholderRegex, (match, key) => {
    const value = data[key.trim()];
    return value !== undefined ? value : match;
  });

  return result;
}

/**
 * Parse inline markdown formatting (**bold**, etc.) and create formatting requests
 * Returns { text: plainText, formatRanges: [{start, end, format}] }
 */
function parseInlineMarkdown(text, startIndex) {
  const formatRanges = [];
  let plainText = '';
  let currentIndex = 0;

  // Parse **bold** text
  const boldRegex = /\*\*(.*?)\*\*/g;
  let match;
  let lastIndex = 0;

  while ((match = boldRegex.exec(text)) !== null) {
    // Add text before the match
    plainText += text.substring(lastIndex, match.index);

    // Add the bold text (without asterisks)
    const boldStart = startIndex + plainText.length;
    plainText += match[1]; // The text inside **...**
    const boldEnd = startIndex + plainText.length;

    formatRanges.push({
      startIndex: boldStart,
      endIndex: boldEnd,
      bold: true
    });

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  plainText += text.substring(lastIndex);

  return { text: plainText, formatRanges };
}
