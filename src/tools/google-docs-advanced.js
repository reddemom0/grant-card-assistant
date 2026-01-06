/**
 * Advanced Google Docs Formatting for Granted Consulting
 * Creates documents with specific branding and layout
 */

import { google } from 'googleapis';
import { getTemplate } from './doc-templates/index.js';
import { createGoogleDocFromTemplate } from './google-docs-construction.js';
import Anthropic from '@anthropic-ai/sdk';

/**
 * Logo URL - can be overridden via GRANTED_LOGO_URL environment variable
 * For now using a direct Google Drive link (update this after uploading logo)
 */
const LOGO_URL = process.env.GRANTED_LOGO_URL || 'https://drive.google.com/uc?export=view&id=PLACEHOLDER';

/**
 * Brand colors (Granted Consulting)
 */
const BRAND_COLORS = {
  // Primary blue for headers (#008abf)
  HEADER_BLUE: {
    color: {
      rgbColor: {
        red: 0,
        green: 0.541,  // 138/255
        blue: 0.749    // 191/255
      }
    }
  },
  // Grey for secondary text (#6d7881)
  GREY: {
    color: {
      rgbColor: {
        red: 0.427,    // 109/255
        green: 0.471,  // 120/255
        blue: 0.506    // 129/255
      }
    }
  },
  // Light grey for subtle elements (#dde1e3)
  LIGHT_GREY: {
    color: {
      rgbColor: {
        red: 0.867,    // 221/255
        green: 0.882,  // 225/255
        blue: 0.890    // 227/255
      }
    }
  },
  // Legacy - Dark gray for title text (keeping for backward compatibility)
  TITLE_GRAY: {
    color: {
      rgbColor: {
        red: 0.4,      // 102/255
        green: 0.4,
        blue: 0.4
      }
    }
  },
  // Red for warning text
  WARNING_RED: {
    color: {
      rgbColor: {
        red: 1.0,
        green: 0,
        blue: 0
      }
    }
  },
  // Black for body text
  BODY_BLACK: {
    color: {
      rgbColor: {
        red: 0,
        green: 0,
        blue: 0
      }
    }
  }
};

/**
 * Document styling constants
 */
const STYLES = {
  BODY_FONT: 'Arial',
  BODY_SIZE: 11,
  HEADING_SIZE: 17,  // Updated to match PDF template specification
  TITLE_SIZE: 18,
  LINE_SPACING: 100, // Single spacing (100%)
  MARGINS: {
    top: 72,    // 1 inch = 72 points
    bottom: 72,
    left: 72,
    right: 72
  }
};

/**
 * Render table as formatted text (pipe-separated values)
 * This is safer and more reliable than complex table API calculations
 * @param {Array<string>} headers - Column headers
 * @param {Array<Array<string>>} rows - Table rows
 * @returns {string} Formatted table text
 */
function renderTableAsText(headers, rows = []) {
  const lines = [];

  // Header row
  lines.push(headers.join(' | '));

  // Separator line
  lines.push(headers.map(h => '─'.repeat(h.length)).join('─┼─'));

  // Data rows
  rows.forEach(row => {
    lines.push(row.join(' | '));
  });

  return lines.join('\n') + '\n\n';
}

/**
 * Parse markdown content into structured elements (text blocks and tables)
 * @param {string} content - Markdown formatted content
 * @returns {Array} Array of {type, content, position} objects
 */
function parseMarkdownStructure(content) {
  const elements = [];
  const lines = content.split('\n');
  let currentTextBlock = [];
  let lineIndex = 0;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Check for table markers
    if (line.trim() === '[TABLE:yes-no]') {
      // Save any accumulated text
      if (currentTextBlock.length > 0) {
        elements.push({
          type: 'text',
          content: currentTextBlock.join('\n'),
          lineStart: lineIndex - currentTextBlock.length,
          lineEnd: lineIndex
        });
        currentTextBlock = [];
      }

      // Add simple yes/no table
      elements.push({
        type: 'table',
        headers: ['Yes', 'No'],
        rows: [],
        lineStart: lineIndex,
        lineEnd: lineIndex + 1
      });
      lineIndex++;
      i++;
      continue;
    }

    if (line.trim() === '[TABLE:yes-no-partial]') {
      // Save any accumulated text
      if (currentTextBlock.length > 0) {
        elements.push({
          type: 'text',
          content: currentTextBlock.join('\n'),
          lineStart: lineIndex - currentTextBlock.length,
          lineEnd: lineIndex
        });
        currentTextBlock = [];
      }

      // Add simple yes/no/partial table
      elements.push({
        type: 'table',
        headers: ['Yes', 'No', 'Partial'],
        rows: [],
        lineStart: lineIndex,
        lineEnd: lineIndex + 1
      });
      lineIndex++;
      i++;
      continue;
    }

    if (line.trim() === '[TABLE:start]') {
      // Save any accumulated text
      if (currentTextBlock.length > 0) {
        elements.push({
          type: 'text',
          content: currentTextBlock.join('\n'),
          lineStart: lineIndex - currentTextBlock.length,
          lineEnd: lineIndex
        });
        currentTextBlock = [];
      }

      i++;
      lineIndex++;
      let headers = [];
      let rows = [];
      const tableStartLine = lineIndex - 1;

      // Parse table content
      while (i < lines.length && lines[i].trim() !== '[TABLE:end]') {
        const tableLine = lines[i].trim();
        if (tableLine.startsWith('[HEADERS]')) {
          headers = tableLine.substring(9).split('|').map(h => h.trim());
        } else if (tableLine.startsWith('[ROW]')) {
          const rowData = tableLine.substring(5).split('|').map(c => c.trim());
          rows.push(rowData);
        }
        i++;
        lineIndex++;
      }

      elements.push({
        type: 'table',
        headers: headers,
        rows: rows,
        lineStart: tableStartLine,
        lineEnd: lineIndex + 1
      });

      i++; // Skip [TABLE:end]
      lineIndex++;
      continue;
    }

    // Regular text line
    currentTextBlock.push(line);
    lineIndex++;
    i++;
  }

  // Save any remaining text
  if (currentTextBlock.length > 0) {
    elements.push({
      type: 'text',
      content: currentTextBlock.join('\n'),
      lineStart: lineIndex - currentTextBlock.length,
      lineEnd: lineIndex
    });
  }

  return elements;
}

/**
 * PHASE 1: Generate requests to create document structure
 * Strategy: Convert everything to markdown (tables as markers), let existing processor handle it
 * @param {string} markdown - Full markdown content with table markers
 * @param {number} startIndex - Starting index in document
 * @returns {Object} { requests: Array, tableMarkers: Array }
 */
function generatePhase1Requests(markdown, startIndex = 1) {
  // Use existing markdown processor - it handles indexes correctly
  const requests = markdownToGrantedDocsRequests(markdown, startIndex);

  // Extract table marker positions by scanning the markdown
  const tableMarkers = [];
  const lines = markdown.split('\n');
  let lineIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trim() === '[TABLE:yes-no]') {
      tableMarkers.push({ type: 'yes-no', lineIndex: i, headers: ['Yes', 'No'], rows: [] });
    } else if (line.trim() === '[TABLE:yes-no-partial]') {
      tableMarkers.push({ type: 'yes-no-partial', lineIndex: i, headers: ['Yes', 'No', 'Partial'], rows: [] });
    } else if (line.trim() === '[TABLE:start]') {
      let headers = [];
      let rows = [];
      i++;
      while (i < lines.length && lines[i].trim() !== '[TABLE:end]') {
        const tableLine = lines[i].trim();
        if (tableLine.startsWith('[HEADERS]')) {
          headers = tableLine.substring(9).split('|').map(h => h.trim());
        } else if (tableLine.startsWith('[ROW]')) {
          rows.push(tableLine.substring(5).split('|').map(c => c.trim()));
        }
        i++;
      }
      tableMarkers.push({ type: 'custom', lineIndex: lineIndex, headers, rows });
    }
  }

  return { requests, tableMarkers };
}

/**
 * PHASE 2: Replace text-based tables with real Google Docs tables
 * Strategy:
 *  1. Search document text for table patterns (pipes and dashes)
 *  2. Find their start/end indexes
 *  3. Delete text tables
 *  4. Insert real Google Docs table structures
 *  5. Populate cells
 *
 * @param {Object} document - Document from documents.get()
 * @param {Array} tableMarkers - Metadata about tables from Phase 1
 * @returns {Promise<Array>} Array of requests to replace tables
 */
async function generatePhase2TableReplacements(document, tableMarkers) {
  const requests = [];
  const body = document.tabs?.[0]?.documentTab?.body || document.body;

  if (!body || !body.content) {
    return requests;
  }

  // Find text-based table patterns in document content
  const textTableRanges = findTextTableRanges(body, tableMarkers.length);

  // Process in reverse order (write backwards) to avoid index shifts
  for (let i = textTableRanges.length - 1; i >= 0; i--) {
    const range = textTableRanges[i];
    const tableInfo = tableMarkers[i];

    if (!range || !tableInfo) continue;

    const { startIndex, endIndex } = range;
    const { headers, rows } = tableInfo;

    // 1. Delete the text-based table
    requests.push({
      deleteContentRange: {
        range: {
          startIndex: startIndex,
          endIndex: endIndex
        }
      }
    });

    // 2. Insert real table structure at the same position
    const numRows = rows.length > 0 ? rows.length + 1 : 1; // +1 for header row
    const numCols = headers.length;

    requests.push({
      insertTable: {
        location: { index: startIndex },
        rows: numRows,
        columns: numCols
      }
    });
  }

  // After structural changes, we need to read document again to populate cells
  // For now, return these requests and we'll do population in a third phase if needed
  return requests;
}

/**
 * Find text-based table patterns in document
 * Looks for pipe-separated tables with headers and separator lines
 * @param {Object} body - Document body
 * @param {number} expectedCount - Expected number of tables
 * @returns {Array} Array of {startIndex, endIndex} ranges
 */
function findTextTableRanges(body, expectedCount) {
  const ranges = [];

  // Flatten all content elements with their text
  const contentElements = [];
  for (const element of body.content) {
    if (element.paragraph?.elements) {
      for (const paraElement of element.paragraph.elements) {
        if (paraElement.textRun?.content) {
          contentElements.push({
            text: paraElement.textRun.content,
            startIndex: paraElement.startIndex,
            endIndex: paraElement.endIndex
          });
        }
      }
    }
  }

  // Find complete tables by looking for separator pattern (─┼─)
  let i = 0;
  while (i < contentElements.length && ranges.length < expectedCount) {
    const elem = contentElements[i];

    // Look for table separator line: contains ─┼─
    if (elem.text.includes('─┼─')) {
      // Found a separator - this indicates a table
      // Look backwards for header row (line before separator)
      let tableStartIndex = elem.startIndex;
      if (i > 0) {
        // Start from previous element (header row)
        tableStartIndex = contentElements[i - 1].startIndex;
      }

      // Scan forward to find all rows (lines with | but not ─┼─)
      let tableEndIndex = elem.endIndex;
      for (let j = i + 1; j < contentElements.length; j++) {
        const nextElem = contentElements[j];

        // If this line has pipes (data row), include it
        if (nextElem.text.includes(' | ')) {
          tableEndIndex = nextElem.endIndex;
        } else if (!nextElem.text.trim() || nextElem.text === '\n') {
          // Empty line after table - end here
          break;
        } else {
          // Non-table content - end of table
          break;
        }
      }

      ranges.push({
        startIndex: tableStartIndex,
        endIndex: tableEndIndex
      });

      console.log(`   📊 Found text table: indices ${tableStartIndex}-${tableEndIndex}`);
    }

    i++;
  }

  return ranges;
}

/**
 * PHASE 3: Populate table cells with data
 * Uses ACTUAL cell paragraph indexes from the re-fetched document (not calculated offsets)
 *
 * IMPORTANT: The calculated offset approach from examples only works when creating
 * and populating tables in ONE batchUpdate. Since we create empty tables in Phase 2,
 * then populate in Phase 3, we must use the actual cell indexes from the document.
 *
 * Must insert in REVERSE order to avoid index shifts when inserting text.
 *
 * @param {Object} document - Updated document after Phase 2
 * @param {Array} tableMarkers - Table metadata from Phase 1
 * @returns {Array} Array of insertText and formatting requests (in reverse order)
 */
function generatePhase3CellPopulation(document, tableMarkers) {
  const requests = [];
  const body = document.tabs?.[0]?.documentTab?.body || document.body;

  // Extract all tables from document
  const tableElements = body.content.filter(el => el.table);

  console.log(`   📊 Found ${tableElements.length} tables in document, populating ${Math.min(tableElements.length, tableMarkers.length)}...`);

  // Populate each table with its corresponding data
  for (let tableIndex = 0; tableIndex < Math.min(tableElements.length, tableMarkers.length); tableIndex++) {
    const tableElement = tableElements[tableIndex];
    const tableInfo = tableMarkers[tableIndex];
    const table = tableElement.table;

    if (!table || !table.tableRows) {
      console.log(`   ⚠️  Table ${tableIndex}: Missing table or tableRows`);
      continue;
    }

    console.log(`   📍 Table ${tableIndex}: ${table.tableRows.length} rows, populating with ${tableInfo.headers.length} headers + ${tableInfo.rows.length} data rows`);

    // Populate header row (row 0)
    if (table.tableRows[0]) {
      const headerRow = table.tableRows[0];
      for (let col = 0; col < tableInfo.headers.length; col++) {
        const cell = headerRow.tableCells?.[col];
        if (!cell || !cell.content || !cell.content[0]) {
          console.log(`   ⚠️  Table ${tableIndex}, header col ${col}: Missing cell content`);
          continue;
        }

        const cellContent = cell.content[0];

        // Validate that the content has a paragraph with startIndex
        if (!cellContent.paragraph || typeof cellContent.startIndex !== 'number') {
          console.log(`   ⚠️  Table ${tableIndex}, header col ${col}: Invalid paragraph structure`);
          continue;
        }

        // Use ACTUAL cell paragraph startIndex (empty cells only have 1 char - the newline)
        const insertIndex = cellContent.startIndex;
        const headerText = tableInfo.headers[col];

        // Skip empty header text (Google Docs API rejects empty insertText)
        if (!headerText || headerText.trim().length === 0) {
          continue;
        }

        // Insert header text
        requests.push({
          insertText: {
            location: { index: insertIndex },
            text: headerText
          }
        });

        // Make header bold
        requests.push({
          updateTextStyle: {
            range: {
              startIndex: insertIndex,
              endIndex: insertIndex + headerText.length
            },
            textStyle: {
              bold: true
            },
            fields: 'bold'
          }
        });
      }
    }

    // Populate data rows
    for (let rowIndex = 0; rowIndex < tableInfo.rows.length; rowIndex++) {
      const rowData = tableInfo.rows[rowIndex];
      const tableRowIndex = rowIndex + 1; // +1 because row 0 is headers

      if (!table.tableRows[tableRowIndex]) {
        console.log(`   ⚠️  Table ${tableIndex}: Missing row ${tableRowIndex}`);
        continue;
      }

      const tableRow = table.tableRows[tableRowIndex];

      for (let col = 0; col < rowData.length; col++) {
        const cell = tableRow.tableCells?.[col];
        if (!cell || !cell.content || !cell.content[0]) {
          console.log(`   ⚠️  Table ${tableIndex}, row ${tableRowIndex}, col ${col}: Missing cell content`);
          continue;
        }

        const cellContent = cell.content[0];

        // Validate paragraph structure
        if (!cellContent.paragraph || typeof cellContent.startIndex !== 'number') {
          console.log(`   ⚠️  Table ${tableIndex}, row ${tableRowIndex}, col ${col}: Invalid paragraph structure`);
          continue;
        }

        // Use ACTUAL cell paragraph startIndex (empty cells only have 1 char - the newline)
        const insertIndex = cellContent.startIndex;
        const cellText = rowData[col];

        // Skip empty cell text (Google Docs API rejects empty insertText)
        if (!cellText || cellText.trim().length === 0) {
          continue;
        }

        requests.push({
          insertText: {
            location: { index: insertIndex },
            text: cellText
          }
        });
      }
    }
  }

  console.log(`   ✓ Generated ${requests.length} cell population requests`);

  // DEBUG: Log first and last few requests to see the range
  if (requests.length > 0) {
    console.log(`   🔍 First 3 requests (before reversal):`);
    for (let i = 0; i < Math.min(3, requests.length); i++) {
      const req = requests[i];
      if (req.insertText) {
        console.log(`      [${i}] insertText at ${req.insertText.location.index}: "${req.insertText.text.substring(0, 20)}..."`);
      } else if (req.updateTextStyle) {
        console.log(`      [${i}] updateTextStyle ${req.updateTextStyle.range.startIndex}-${req.updateTextStyle.range.endIndex}`);
      }
    }
    console.log(`   🔍 Last 3 requests (before reversal):`);
    for (let i = Math.max(0, requests.length - 3); i < requests.length; i++) {
      const req = requests[i];
      if (req.insertText) {
        console.log(`      [${i}] insertText at ${req.insertText.location.index}: "${req.insertText.text.substring(0, 20)}..."`);
      } else if (req.updateTextStyle) {
        console.log(`      [${i}] updateTextStyle ${req.updateTextStyle.range.startIndex}-${req.updateTextStyle.range.endIndex}`);
      }
    }
  }

  // CRITICAL: Reverse requests to avoid index shifts
  // When inserting text at early indexes, it shifts all later indexes
  // By inserting highest index first, we preserve earlier indexes
  requests.reverse();

  console.log(`   ✓ Reversed ${requests.length} requests for proper insertion order`);

  return requests;
}

/**
 * Calculate text length for index tracking (rough estimate)
 * @param {string} text - Text content
 * @returns {number} Approximate length in UTF-16 code units
 */
function calculateTextLength(text) {
  // Each character is 1 unit, plus newlines
  return text.length;
}

/**
 * Process text-only markdown (no tables) - simplified version for Phase 1
 * @param {string} content - Markdown content
 * @param {number} startIndex - Start index
 * @returns {Array} Requests array
 */
function markdownToGrantedDocsRequestsOld(content, startIndex = 1) {
  // For now, just insert as plain text with basic formatting
  // The full implementation with headers, bold, etc. will be the existing markdownToGrantedDocsRequests
  // This is a simplified version for Phase 1 structure creation

  if (!content || content.trim().length === 0) {
    return [];
  }

  const requests = [];
  requests.push({
    insertText: {
      location: { index: startIndex },
      text: content + '\n\n'
    }
  });

  return requests;
}

/**
 * Convert markdown to Google Docs requests with Granted Consulting branding
 * Supports: ##, ###, -, **, *italic*, tables, checkboxes
 * @param {string} content - Markdown formatted content
 * @returns {Array} Array of Google Docs API requests
 */
export function markdownToGrantedDocsRequests(content, startIndex = 1) {
  const requests = [];
  let currentIndex = startIndex; // Start at specified index (default 1)

  // Split content into lines
  const lines = content.split('\n');

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      // Empty line - add a newline
      requests.push({
        insertText: {
          location: { index: currentIndex },
          text: '\n'
        }
      });
      currentIndex += 1;
      i++;
      continue;
    }

    // Warning callout - red text
    if (line.trim().startsWith('[WARNING]')) {
      const text = line.trim().replace(/^\[WARNING\]/, '').replace(/\[\/WARNING\]$/, '') + '\n';
      const startIndex = currentIndex;

      requests.push({
        insertText: {
          location: { index: currentIndex },
          text: text
        }
      });

      // Style as red
      requests.push({
        updateTextStyle: {
          range: {
            startIndex: startIndex,
            endIndex: startIndex + text.length - 1
          },
          textStyle: {
            foregroundColor: BRAND_COLORS.WARNING_RED,
            bold: true
          },
          fields: 'foregroundColor,bold'
        }
      });

      currentIndex += text.length;
      i++;
      continue;
    }

    // Info callout
    if (line.trim().startsWith('[INFO]')) {
      const text = line.trim().replace(/^\[INFO\]/, '').replace(/\[\/INFO\]$/, '') + '\n';
      const startIndex = currentIndex;

      requests.push({
        insertText: {
          location: { index: currentIndex },
          text: text
        }
      });

      // Style with info color (can customize)
      requests.push({
        updateTextStyle: {
          range: {
            startIndex: startIndex,
            endIndex: startIndex + text.length - 1
          },
          textStyle: {
            italic: true
          },
          fields: 'italic'
        }
      });

      currentIndex += text.length;
      i++;
      continue;
    }

    // Simple Yes/No table - rendered as formatted text
    if (line.trim() === '[TABLE:yes-no]') {
      const text = renderTableAsText(['Yes', 'No']);
      requests.push({
        insertText: {
          location: { index: currentIndex },
          text: text
        }
      });
      currentIndex += text.length;
      i++;
      continue;
    }

    // Simple Yes/No/Partial table - rendered as formatted text
    if (line.trim() === '[TABLE:yes-no-partial]') {
      const text = renderTableAsText(['Yes', 'No', 'Partial']);
      requests.push({
        insertText: {
          location: { index: currentIndex },
          text: text
        }
      });
      currentIndex += text.length;
      i++;
      continue;
    }

    // Full table with headers and rows - rendered as formatted text
    if (line.trim() === '[TABLE:start]') {
      i++;
      let headers = [];
      let rows = [];

      // Parse table content
      while (i < lines.length && lines[i].trim() !== '[TABLE:end]') {
        const tableLine = lines[i].trim();
        if (tableLine.startsWith('[HEADERS]')) {
          headers = tableLine.substring(9).split('|');
        } else if (tableLine.startsWith('[ROW]')) {
          const rowData = tableLine.substring(5).split('|');
          rows.push(rowData);
        }
        i++;
      }

      // Render as formatted text
      const text = renderTableAsText(headers, rows);
      requests.push({
        insertText: {
          location: { index: currentIndex },
          text: text
        }
      });
      currentIndex += text.length;
      i++; // Skip [TABLE:end]
      continue;
    }

    // Horizontal divider (---)
    if (line.trim() === '---') {
      const text = '_______________________________________________________________________________\n';
      const startIndex = currentIndex;

      requests.push({
        insertText: {
          location: { index: currentIndex },
          text: text
        }
      });

      // Style as light gray
      requests.push({
        updateTextStyle: {
          range: {
            startIndex: startIndex,
            endIndex: startIndex + text.length - 1
          },
          textStyle: {
            foregroundColor: {
              color: {
                rgbColor: { red: 0.8, green: 0.8, blue: 0.8 }
              }
            }
          },
          fields: 'foregroundColor'
        }
      });

      currentIndex += text.length;
      i++;
      continue;
    }

    // Section Header (## ) - Blue, bold, larger
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
            foregroundColor: BRAND_COLORS.HEADER_BLUE
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
      i++;
    }
    // Subsection (### ) - Blue heading style (same as level 1 but smaller)
    else if (line.startsWith('### ')) {
      const text = line.substring(4) + '\n';
      const startIndex = currentIndex;

      requests.push({
        insertText: {
          location: { index: currentIndex },
          text: text
        }
      });

      // Make it blue, bold, and medium size (matching level 1 but 14pt instead of 17pt)
      requests.push({
        updateTextStyle: {
          range: {
            startIndex: startIndex,
            endIndex: startIndex + text.length - 1
          },
          textStyle: {
            bold: true,
            fontSize: {
              magnitude: 14,
              unit: 'PT'
            },
            foregroundColor: BRAND_COLORS.HEADER_BLUE
          },
          fields: 'bold,fontSize,foregroundColor'
        }
      });

      currentIndex += text.length;
      i++;
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
      i++;
    }
    // Checkbox (☐ or [ ]) - TEMPORARILY SIMPLIFIED (using text instead of API checkboxes)
    else if (line.trim().startsWith('☐') || line.trim().startsWith('[ ]')) {
      const text = '☐ ' + line.trim().replace(/^(☐|\[\s?\])/, '').trim() + '\n';

      requests.push({
        insertText: {
          location: { index: currentIndex },
          text: text
        }
      });

      currentIndex += text.length;
      i++;
    }
    // Regular text with inline formatting
    else {
      const processedLine = processInlineFormatting(line, currentIndex, requests);
      currentIndex = processedLine.newIndex;
      i++;
    }
  }

  return requests;
}

/**
 * Process inline formatting: **bold**, *italic*
 * @param {string} line - Line of text
 * @param {number} startIndex - Starting index in document
 * @param {Array} requests - Requests array to append to
 * @returns {Object} Updated index
 */
function processInlineFormatting(line, startIndex, requests) {
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
      location: { index: startIndex },
      text: processedText
    }
  });

  // Apply formatting
  let offset = 0;
  for (const range of formatRanges.sort((a, b) => a.start - b.start)) {
    const adjustedStart = startIndex + range.start - offset;
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

  return { newIndex: startIndex + processedText.length };
}

/**
 * Generate document header requests with Granted Consulting branding
 * Returns requests array and the offset to use for subsequent content
 * @returns {Object} { requests: Array, offset: number }
 */
export function generateGrantedHeaderRequests() {
  const requests = [];
  let offset;

  // Check if we have a valid logo URL
  // Must be set via GRANTED_LOGO_URL env var and not contain PLACEHOLDER
  // Must also start with http:// or https:// to be valid
  const hasLogo = LOGO_URL &&
                  !LOGO_URL.includes('PLACEHOLDER') &&
                  (LOGO_URL.startsWith('http://') || LOGO_URL.startsWith('https://'));

  // Log logo status for debugging
  if (hasLogo) {
    console.log(`   🖼️  Using logo: ${LOGO_URL.substring(0, 50)}...`);
  } else {
    console.log(`   📝 Using text header (GRANTED_LOGO_URL not configured)`);
  }

  if (hasLogo) {
    // Insert logo image at the top
    // Note: inline image has length 1 according to Google Docs API
    requests.push({
      insertInlineImage: {
        location: { index: 1 },
        uri: LOGO_URL,
        objectSize: {
          height: {
            magnitude: 40,
            unit: 'PT'
          },
          width: {
            magnitude: 200,
            unit: 'PT'
          }
        }
      }
    });

    // Add newlines after the logo
    requests.push({
      insertText: {
        location: { index: 2 },
        text: '\n\n'
      }
    });

    // Right-align the logo paragraph
    requests.push({
      updateParagraphStyle: {
        range: {
          startIndex: 1,
          endIndex: 2
        },
        paragraphStyle: {
          alignment: 'END'
        },
        fields: 'alignment'
      }
    });

    // Offset: image (1) + newlines (2) = 3
    offset = 3;
  } else {
    // Fallback to text-based header if logo not available
    const headerText = 'GRANTED CONSULTING\n\n';

    requests.push({
      insertText: {
        location: { index: 1 },
        text: headerText
      }
    });

    // Style the header text
    requests.push({
      updateTextStyle: {
        range: {
          startIndex: 1,
          endIndex: 19 // "GRANTED CONSULTING" length
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
          }
        },
        fields: 'fontSize,foregroundColor'
      }
    });

    // Right-align the header
    requests.push({
      updateParagraphStyle: {
        range: {
          startIndex: 1,
          endIndex: headerText.length
        },
        paragraphStyle: {
          alignment: 'END'
        },
        fields: 'alignment'
      }
    });

    // Offset: full text length
    offset = headerText.length;
  }

  return { requests, offset };
}

/**
 * Set document-wide styles (margins, default font, line spacing)
 * @param {Object} docsClient - Google Docs API client
 * @param {string} documentId - Document ID
 * @returns {Promise<void>}
 */
export async function setDocumentStyles(docsClient, documentId) {
  await docsClient.documents.batchUpdate({
    documentId: documentId,
    requestBody: {
      requests: [
        // Set page margins
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
              },
              defaultHeaderId: '',
              defaultFooterId: ''
            },
            fields: 'marginTop,marginBottom,marginLeft,marginRight'
          }
        },
        // Set default text style
        {
          updateTextStyle: {
            range: {
              startIndex: 1,
              endIndex: 2
            },
            textStyle: {
              weightedFontFamily: {
                fontFamily: STYLES.BODY_FONT
              },
              fontSize: {
                magnitude: STYLES.BODY_SIZE,
                unit: 'PT'
              }
            },
            fields: 'weightedFontFamily,fontSize'
          }
        }
      ]
    }
  });
}

/**
 * Tool wrapper: Create advanced document from template
 * Integrates with Direct Claude API tool system
 * @param {Object} input - Tool input parameters
 * @param {string} input.title - Document title
 * @param {string} input.grantType - Grant type (hiring, market-expansion, training, rd, loan, investment)
 * @param {string} input.documentType - Document type (readiness-assessment, interview-questions, evaluation-rubric)
 * @param {Object} input.data - Optional data for placeholders
 * @param {string} input.parentFolderId - Optional parent folder ID
 * @param {Object} context - Execution context with userId
 * @returns {Promise<Object>} Result with success status and document URL
 */
/**
 * Convert structured template to markdown format
 * @param {Object} template - Structured template object
 * @param {Object} data - Data to fill placeholders
 * @returns {string} Markdown formatted content
 */
function templateToMarkdown(template, data) {
  const lines = [];

  // Merge template defaults with provided data
  const mergedData = { ...template.defaultData, ...data };

  for (const section of template.sections) {
    const text = section.text || '';
    const processedText = replacePlaceholders(text, mergedData);

    switch (section.type) {
      case 'title':
        lines.push(`# ${processedText}`);
        lines.push('');
        break;

      case 'divider':
        lines.push('---');
        lines.push('');
        break;

      case 'header':
        if (section.level === 1) {
          lines.push(`## ${processedText}`);
        } else if (section.level === 2) {
          lines.push(`### ${processedText}`);
        } else {
          lines.push(`#### ${processedText}`);
        }
        lines.push('');
        break;

      case 'subheader':
        lines.push(`**${processedText}**`);
        lines.push('');
        break;

      case 'paragraph':
        lines.push(processedText);
        lines.push('');
        break;

      case 'list':
      case 'checklist':
        if (section.items) {
          section.items.forEach(item => {
            const processedItem = replacePlaceholders(item, mergedData);
            if (section.type === 'checklist') {
              lines.push(`☐ ${processedItem}`);
            } else {
              lines.push(`- ${processedItem}`);
            }
          });
          lines.push('');
        }
        break;

      case 'numbered-questions':
        if (section.items) {
          section.items.forEach((item, index) => {
            const processedItem = replacePlaceholders(item, mergedData);
            lines.push(`**${index + 1}.** ${processedItem}`);
            lines.push('');
          });
        }
        break;

      case 'question':
        // Questions should be in bold+italic
        const questionNum = section.number ? `**${section.number}.** ` : '';
        const questionText = replacePlaceholders(section.text, mergedData);
        lines.push(`${questionNum}***${questionText}***`);

        // Add follow-up text if present
        if (section.followup && section.followup.length > 0) {
          section.followup.forEach(followupText => {
            const processedFollowup = replacePlaceholders(followupText, mergedData);
            lines.push(`   ${processedFollowup}`);
          });
        }

        // Add Yes/No table if present
        if (section.table && section.table.type === 'yes-no') {
          lines.push('[TABLE:yes-no]');
        } else if (section.table && section.table.type === 'yes-no-partial') {
          lines.push('[TABLE:yes-no-partial]');
        }
        lines.push('');
        break;

      case 'callout':
        // Callouts with warning style should be red
        if (section.style === 'warning') {
          lines.push(`[WARNING]${processedText}[/WARNING]`);
        } else if (section.style === 'info') {
          lines.push(`[INFO]${processedText}[/INFO]`);
        } else {
          lines.push(processedText);
        }
        lines.push('');
        break;

      case 'table':
        // Create table marker with data
        lines.push('[TABLE:start]');
        if (section.headers) {
          const processedHeaders = section.headers.map(h => replacePlaceholders(h, mergedData));
          lines.push(`[HEADERS]${processedHeaders.join('|')}`);
        }
        if (section.rows) {
          section.rows.forEach(row => {
            const processedRow = row.map(cell => replacePlaceholders(cell, mergedData));
            lines.push(`[ROW]${processedRow.join('|')}`);
          });
        }
        lines.push('[TABLE:end]');
        lines.push('');
        break;

      default:
        // For other types, just add the text
        if (processedText) {
          lines.push(processedText);
          lines.push('');
        }
    }
  }

  return lines.join('\n');
}

/**
 * Replace {{placeholders}} in text
 */
function replacePlaceholders(text, data) {
  if (!text) return '';
  return text.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    const value = data[key.trim()];
    return value !== undefined ? value : match;
  });
}

/**
 * Dynamically generate interview questions based on grant criteria using Claude API
 * @param {string} grantType - Type of grant (hiring, market-expansion, etc.)
 * @param {string} grantCriteria - Grant program's evaluation criteria
 * @param {Object} data - Optional data for placeholders (program_name, client_name, etc.)
 * @param {string} companyContext - Optional company information from HubSpot for company-specific questions
 * @returns {Promise<Object>} Template structure with generated questions and optional fit assessment
 */
async function generateInterviewQuestionsFromCriteria(grantType, grantCriteria, data = {}, companyContext = null) {
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
  });

  const program_name = data.program_name || '[Program Name]';
  const client_name = data.client_name || '[Company Name]';
  const interview_date = data.interview_date || new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  let prompt;

  if (companyContext) {
    // Company-specific questions with fit assessment
    prompt = `You are creating strategic interview questions for Granted Consulting's grant readiness assessment for a SPECIFIC COMPANY. These questions will be used by consultants to assess this company's fit for this grant program.

GRANT PROGRAM CRITERIA:
${grantCriteria}

COMPANY INFORMATION (from HubSpot CRM):
${companyContext}

YOUR TASK:
1. Generate exactly 10 strategic interview questions TAILORED TO THIS SPECIFIC COMPANY
2. Provide a preliminary fit assessment (2-3 sentences)

QUESTION DESIGN - COMPANY-SPECIFIC APPROACH:
- **Reference their situation** - Questions should reflect what you know about them (e.g., "Given you're currently selling domestically..." or "With your manufacturing background...")
- **Probe their specific gaps** - Based on company info, what might be missing for this grant? Ask questions that reveal those areas
- **Strategic, not checklist** - Don't ask "Do you meet X?" Ask questions that reveal WHETHER they meet X
- **Consultative tone** - Help them think through their specific situation

EXAMPLES OF COMPANY-SPECIFIC QUESTIONS:
- For $5M manufacturing company targeting exports: "You're currently at $5M in domestic sales - walk me through how export revenue would fit into your growth plan over the next 2-3 years."
- For company with no export experience applying to CanExport: "You mentioned you haven't exported before. What's driving your interest in [target market] specifically, versus other international opportunities?"
- For 50-person team applying for innovation grant: "With your current team of 50, how would you structure the innovation project team? What skills do you have in-house vs need to bring in?"

FIT ASSESSMENT GUIDANCE:
Based on company info and grant criteria, provide honest preliminary assessment:
- **Strong fit** if they clearly align with eligibility and priorities
- **Moderate fit** if they meet basics but have gaps or concerns
- **Weak fit** if significant eligibility issues or misalignment with priorities
Include specific reasons (1-2 strengths, 1-2 concerns or gaps to explore in interview)

FORMAT:
Return your response in this exact format:

PRELIMINARY FIT ASSESSMENT:
[2-3 sentences assessing fit level and key reasons]

INTERVIEW QUESTIONS:
1. [Company-specific strategic question]
2. [Question tailored to their situation]
...
10. [Question assessing their specific capacity or impact]`;
  } else {
    // Generic questions without company context
    prompt = `You are creating strategic interview questions for Granted Consulting's grant readiness assessment. These questions will be used by consultants to assess whether a client is a good fit for this grant program.

GRANT PROGRAM CRITERIA:
${grantCriteria}

YOUR TASK:
Generate exactly 10 strategic, consultative interview questions that help the consulting team:
1. **Assess company suitability** - Is this company a good fit for this grant? Do they meet the underlying intent, not just technical requirements?
2. **Understand project scope** - What is the client actually trying to accomplish? Is the project well-defined and feasible?
3. **Evaluate potential impact** - What outcomes will this project deliver? Are the expected results realistic and meaningful?

QUESTION DESIGN PRINCIPLES:
- **Strategic, not checklist** - Don't ask "Do you meet X?" Ask questions that reveal WHETHER they meet X through their answer
- **Open-ended discovery** - Questions should prompt detailed responses that reveal readiness, gaps, and risks
- **Consultative tone** - Help the client think through their project while gathering assessment information
- **Practical focus** - Questions should uncover real capabilities, not aspirational statements
- **Flow logically** - Start with high-level context (company/project overview), then dive into specific areas

EXAMPLES OF GOOD STRATEGIC QUESTIONS:
- "Walk me through your current export activities and what's driving your interest in expanding to [target market]?" (reveals export readiness without asking directly)
- "What problem are you trying to solve with this project, and why now?" (uncovers project rationale and timing)
- "Describe the team who will execute this project - who's doing what, and what similar projects have they delivered?" (assesses capacity without yes/no)
- "If this project succeeds, what does your business look like in 2 years? What metrics change?" (evaluates impact understanding)

AVOID:
- Yes/no questions ("Do you have export experience?")
- Checklist questions ("Have you completed market research?")
- Leading questions that tell them the "right" answer
- Overly technical jargon that intimidates clients

FORMAT:
Return ONLY a numbered list of 10 questions, one per line. No explanations, categories, or other text.

Example format:
1. [Strategic question revealing company context]
2. [Question uncovering project scope and motivation]
...
10. [Question assessing capacity or impact]`;
  }

  try {
    const message = await anthropic.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: prompt
      }]
    });

    const responseText = message.content[0].text;

    let fitAssessment = null;
    let questions = [];

    if (companyContext) {
      // Parse company-specific response with fit assessment
      const sections = responseText.split(/INTERVIEW QUESTIONS:/i);

      if (sections.length >= 2) {
        // Extract fit assessment
        const assessmentSection = sections[0];
        const assessmentMatch = assessmentSection.match(/PRELIMINARY FIT ASSESSMENT:?\s*\n?(.*)/is);
        if (assessmentMatch) {
          fitAssessment = assessmentMatch[1].trim();
        }

        // Extract questions from second section
        const questionsText = sections[1];
        const lines = questionsText.trim().split('\n').filter(line => line.trim());

        for (const line of lines) {
          const match = line.match(/^\d+[\.)]\s*(.+)$/);
          if (match) {
            questions.push(match[1].trim());
          }
        }
      } else {
        // Fallback if format wasn't followed exactly
        console.warn('Expected format not found, trying to parse questions only');
        const lines = responseText.trim().split('\n').filter(line => line.trim());
        for (const line of lines) {
          const match = line.match(/^\d+[\.)]\s*(.+)$/);
          if (match) {
            questions.push(match[1].trim());
          }
        }
      }
    } else {
      // Parse generic questions (original logic)
      const lines = responseText.trim().split('\n').filter(line => line.trim());
      for (const line of lines) {
        const match = line.match(/^\d+[\.)]\s*(.+)$/);
        if (match) {
          questions.push(match[1].trim());
        }
      }
    }

    // Validate we got 10 questions
    if (questions.length < 8 || questions.length > 12) {
      console.warn(`Generated ${questions.length} questions, expected 10. Using anyway.`);
    }

    // Build template structure matching static template format
    const sections = [
      {
        type: 'title',
        text: `${program_name} Interview Questions`,
        style: 'title-large'
      },
      {
        type: 'paragraph',
        text: `Client: ${client_name}`
      },
      {
        type: 'paragraph',
        text: `Date: ${interview_date}`
      },
      {
        type: 'divider'
      }
    ];

    // Add fit assessment if we have it
    if (fitAssessment && companyContext) {
      sections.push(
        {
          type: 'header',
          level: 2,
          text: 'Preliminary Fit Assessment',
          style: 'header-branded'
        },
        {
          type: 'callout',
          text: fitAssessment,
          style: 'callout-info'
        },
        {
          type: 'divider'
        }
      );
    }

    // Add interview questions
    sections.push(
      {
        type: 'header',
        level: 2,
        text: 'Interview Questions',
        style: 'header-branded'
      },
      {
        type: 'numbered-questions',
        items: questions
      }
    );

    return {
      sections,
      defaultData: {
        program_name,
        client_name,
        interview_date
      }
    };

  } catch (error) {
    console.error('Error generating interview questions:', error);
    throw new Error(`Failed to generate interview questions: ${error.message}`);
  }
}

/**
 * Dynamically generate evaluation rubric based on grant criteria using Claude API
 * @param {string} grantType - Type of grant (hiring, market-expansion, etc.)
 * @param {string} grantCriteria - Grant program's evaluation criteria
 * @param {Object} data - Optional data for placeholders (program_name, client_name, etc.)
 * @param {string} companyContext - Optional company information from HubSpot
 * @returns {Promise<Object>} Template structure with generated rubric
 */
async function generateEvaluationRubricFromCriteria(grantType, grantCriteria, data = {}, companyContext = null) {
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
  });

  const program_name = data.program_name || '[Program Name]';
  const client_name = data.client_name || '[Company Name]';
  const evaluation_date = data.evaluation_date || new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const prompt = `You are creating an evaluation rubric for Granted Consulting to assess a client's readiness for a specific grant program. This rubric will be used to score the client's responses from interviews and readiness assessments against the grant's evaluation criteria.

GRANT PROGRAM CRITERIA:
${grantCriteria}

${companyContext ? `COMPANY CONTEXT:\n${companyContext}\n\n` : ''}

YOUR TASK:
Create a comprehensive evaluation rubric with:
1. Scoring guide (1-10 scale definition)
2. Evaluation categories based on the grant criteria (typically 4-6 major categories like A, B, C, D, E)
3. Sub-criteria within each category (2-3 specific areas to assess)
4. Overall assessment section with weighted scoring

RUBRIC STRUCTURE:

**SCORING GUIDE** (use this exact scale):
- 9-10: Exceptional - Exceeds program requirements significantly
- 7-8: Strong - Meets all requirements with clear strengths
- 5-6: Adequate - Meets minimum requirements
- 3-4: Weak - Gaps in key areas
- 1-2: Critical Gap - Fails to meet requirements

**EVALUATION CATEGORIES**:
Based on the grant criteria, create 4-6 major categories (A, B, C, D, E, F) that cover all evaluation areas. Each category should have:
- Clear category name (e.g., "A. TECHNOLOGY READINESS & OWNERSHIP")
- 2-3 sub-criteria with specific evaluation points
- Each sub-criterion needs bullet points of what to assess

Example format:
A. [MAJOR CATEGORY NAME]
A1. [Sub-criterion name]
Evaluation criteria:
• [Specific thing to assess]
• [Specific thing to assess]
• [Specific thing to assess]

**OVERALL ASSESSMENT**:
Include a weighted scoring table with categories and their weights (should total 100%).

**RECOMMENDATION FRAMEWORK**:
- GO / NO-GO / CONDITIONAL GO options
- Space for rationale
- Required actions if conditional
- Next steps

FORMAT YOUR RESPONSE AS STRUCTURED TEXT (NOT MARKDOWN):
Use this exact format:

SCORING GUIDE:
[The 1-10 scale explanation]

[For each category, use this format:]
A. [CATEGORY NAME]

A1. [Sub-criterion name]
Evaluation criteria:
• [Point 1]
• [Point 2]
• [Point 3]

[Repeat for A2, A3, then B1, B2, etc.]

OVERALL ASSESSMENT
[Weighted scoring table structure]

OVERALL RECOMMENDATION: [GO / NO-GO / CONDITIONAL GO]

RATIONALE:
[Explanation template]

REQUIRED ACTIONS (if Conditional GO):
[Action items]

NEXT STEPS:
[Next steps]`;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: prompt
      }]
    });

    const responseText = message.content[0].text;

    // Parse the generated rubric into structured sections with proper formatting
    const sections = [
      {
        type: 'title',
        text: `Evaluation Rubric: ${program_name}`,
        style: 'title-large'
      },
      {
        type: 'paragraph',
        text: `Client: ${client_name}`
      },
      {
        type: 'paragraph',
        text: `For use by: Granted RA Team`
      },
      {
        type: 'paragraph',
        text: `Date: ${evaluation_date}`
      },
      {
        type: 'divider'
      }
    ];

    // Parse the response text into formatted sections
    const lines = responseText.split('\n');
    let currentSection = null;
    let currentCriteria = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (!line) continue;

      // Markdown headers (# Header, ## Header, ### Header, #### Header)
      const markdownHeaderMatch = line.match(/^(#{1,4})\s+(.+)$/);
      if (markdownHeaderMatch) {
        const level = markdownHeaderMatch[1].length; // Number of # symbols
        const headerText = markdownHeaderMatch[2].trim();

        // Map markdown level to our header system
        if (level === 1) {
          // # Title → Skip, we already have title
          sections.push({
            type: 'header',
            level: 2,
            text: headerText,
            style: 'header-branded'
          });
        } else if (level === 2) {
          // ## Header → Level 2 (blue header)
          sections.push({
            type: 'header',
            level: 2,
            text: headerText,
            style: 'header-branded'
          });
        } else if (level >= 3) {
          // ### or #### → Level 3 (subheader)
          sections.push({
            type: 'header',
            level: 3,
            text: headerText,
            style: 'subheader-branded'
          });
        }
        continue;
      }

      // SCORING GUIDE header
      if (line.match(/^SCORING GUIDE:?$/i)) {
        sections.push({
          type: 'header',
          level: 2,
          text: 'SCORING GUIDE',
          style: 'header-branded'
        });
        continue;
      }

      // Major category headers (A. CATEGORY NAME)
      if (line.match(/^[A-F]\.\s+[A-Z\s&]+$/)) {
        sections.push({
          type: 'header',
          level: 2,
          text: line,
          style: 'header-branded'
        });
        continue;
      }

      // Sub-criterion headers (A1. Sub-criterion name)
      if (line.match(/^[A-F]\d+\.\s+.+$/)) {
        // If we have accumulated criteria from previous sub-criterion, add scoring table
        if (currentCriteria.length > 0) {
          sections.push({
            type: 'table',
            headers: ['Score (1-10)', 'What\'s Strong', 'What\'s Missing', 'Recommendations'],
            rows: [
              ['', '', '', '']
            ],
            style: 'evaluation-table'
          });
          currentCriteria = [];
        }

        sections.push({
          type: 'subheader',
          text: line,
          style: 'subheader-branded'
        });
        continue;
      }

      // "Evaluation criteria:" label
      if (line.match(/^Evaluation criteria:?$/i)) {
        sections.push({
          type: 'paragraph',
          text: 'Evaluation criteria:',
          style: 'bold'
        });
        continue;
      }

      // Bullet points (• or - at start)
      if (line.match(/^[•\-]\s+.+$/)) {
        const text = line.replace(/^[•\-]\s+/, '');
        currentCriteria.push(text);
        sections.push({
          type: 'bullet',
          text: text
        });
        continue;
      }

      // OVERALL ASSESSMENT header
      if (line.match(/^OVERALL ASSESSMENT:?$/i)) {
        // Add final scoring table if we have criteria
        if (currentCriteria.length > 0) {
          sections.push({
            type: 'table',
            headers: ['Score (1-10)', 'What\'s Strong', 'What\'s Missing', 'Recommendations'],
            rows: [
              ['', '', '', '']
            ],
            style: 'evaluation-table'
          });
          currentCriteria = [];
        }

        sections.push({
          type: 'header',
          level: 2,
          text: 'OVERALL ASSESSMENT',
          style: 'header-branded'
        });
        continue;
      }

      // OVERALL RECOMMENDATION header
      if (line.match(/^OVERALL RECOMMENDATION:?/i)) {
        sections.push({
          type: 'header',
          level: 3,
          text: 'OVERALL RECOMMENDATION',
          style: 'subheader-branded'
        });
        const recommendation = line.replace(/^OVERALL RECOMMENDATION:?\s*/i, '');
        if (recommendation) {
          sections.push({
            type: 'paragraph',
            text: recommendation,
            style: 'bold'
          });
        }
        continue;
      }

      // Section headers (RATIONALE, REQUIRED ACTIONS, NEXT STEPS)
      if (line.match(/^(RATIONALE|REQUIRED ACTIONS|NEXT STEPS):?$/i)) {
        sections.push({
          type: 'header',
          level: 3,
          text: line.replace(/:$/, ''),
          style: 'subheader-branded'
        });
        continue;
      }

      // Regular paragraphs or list items
      if (line.match(/^\d+\.\s+/)) {
        // Numbered list item
        sections.push({
          type: 'numbered-list-item',
          text: line.replace(/^\d+\.\s+/, '')
        });
      } else if (line.includes(':')) {
        // Key-value pairs (like "A. Technology Viability: 25%")
        sections.push({
          type: 'paragraph',
          text: line,
          style: 'normal'
        });
      } else if (line.length > 0) {
        // Regular paragraph
        sections.push({
          type: 'paragraph',
          text: line,
          style: 'normal'
        });
      }
    }

    return {
      sections,
      defaultData: {
        program_name,
        client_name,
        evaluation_date
      }
    };

  } catch (error) {
    console.error('Error generating evaluation rubric:', error);
    throw new Error(`Failed to generate evaluation rubric: ${error.message}`);
  }
}

export async function createAdvancedDocumentTool(input, context) {
  const { title, grantType, documentType, data = {}, grantCriteria, companyContext, parentFolderId } = input;
  const { userId } = context || {};

  console.log(`📄 Creating advanced document: ${title}`);
  console.log(`   Grant Type: ${grantType}`);
  console.log(`   Document Type: ${documentType}`);
  console.log(`   User ID: ${userId}`);
  if (grantCriteria) {
    console.log(`   Dynamic generation: Using grant criteria to generate questions`);
  }
  if (companyContext) {
    console.log(`   Company-specific: Using HubSpot context to tailor questions`);
  }

  try {
    // Validate required fields
    if (!title || !grantType || !documentType) {
      return {
        success: false,
        error: 'Missing required fields: title, grantType, and documentType are required'
      };
    }

    if (!userId) {
      return {
        success: false,
        error: 'User ID is required for document creation. Ensure user is authenticated.'
      };
    }

    // Check if we should dynamically generate interview questions
    let template;
    if (documentType === 'interview-questions' && grantCriteria) {
      console.log(`   🧠 Dynamically generating interview questions based on grant criteria...`);
      template = await generateInterviewQuestionsFromCriteria(grantType, grantCriteria, data, companyContext);
      console.log(`   ✓ Generated ${template.sections.filter(s => s.type === 'numbered-questions')[0]?.items?.length || 0} questions`);
      if (companyContext) {
        console.log(`   ✓ Included company-specific questions and preliminary fit assessment`);
      }
    } else if (documentType === 'evaluation-rubric' && grantCriteria) {
      console.log(`   🧠 Dynamically generating evaluation rubric based on grant criteria...`);
      template = await generateEvaluationRubricFromCriteria(grantType, grantCriteria, data, companyContext);
      console.log(`   ✓ Generated comprehensive evaluation rubric with scoring framework`);
      if (companyContext) {
        console.log(`   ✓ Tailored rubric to company context`);
      }
    } else {
      // Get static template
      template = getTemplate(grantType, documentType);
      if (!template) {
        return {
          success: false,
          error: `No template found for grant type "${grantType}" and document type "${documentType}"`
        };
      }
      console.log(`   ✓ Template found`);
    }

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

    const docs = google.docs({ version: 'v1', auth: oauth2Client });
    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    // Step 1: Create empty document
    const doc = await docs.documents.create({
      requestBody: {
        title: title
      }
    });

    const documentId = doc.data.documentId;
    console.log(`   ✓ Created empty document: ${documentId}`);

    // Step 2: Convert template to markdown
    const markdown = templateToMarkdown(template, data);
    console.log(`   ✓ Converted template to markdown (${markdown.length} chars)`);

    // Step 3: Generate header requests
    const { requests: headerRequests, offset } = generateGrantedHeaderRequests();
    console.log(`   ✓ Generated header (offset: ${offset})`);

    // Step 4: Check if markdown has tables
    const hasTables = markdown.includes('[TABLE:') || markdown.includes('[TABLE-');

    if (!hasTables) {
      // No tables - use simple single-phase approach
      const contentRequests = markdownToGrantedDocsRequests(markdown, 1 + offset);
      console.log(`   ✓ Generated ${contentRequests.length} content formatting requests`);

      const allRequests = [...headerRequests, ...contentRequests];
      if (allRequests.length > 0) {
        await docs.documents.batchUpdate({
          documentId: documentId,
          requestBody: { requests: allRequests }
        });
        console.log(`   ✓ Applied all formatting (${allRequests.length} total requests)`);
      }
    } else {
      // Has tables - use two-phase approach with real Google Docs tables
      console.log(`   ⟳ Document contains tables - using two-phase approach...`);

      // Phase 1: Create structure with table placeholders
      const { requests: phase1Requests, tableMarkers } = generatePhase1Requests(markdown, 1 + offset);

      const allPhase1 = [...headerRequests, ...phase1Requests];
      if (allPhase1.length > 0) {
        await docs.documents.batchUpdate({
          documentId: documentId,
          requestBody: { requests: allPhase1 }
        });
        console.log(`   ✓ Phase 1: Created document structure`);
      }

      // Phase 2: Replace text tables with real tables
      if (tableMarkers.length > 0) {
        console.log(`   ⟳ Phase 2: Converting ${tableMarkers.length} text tables to real tables...`);

        // Read document to find table text positions
        const document = await docs.documents.get({
          documentId: documentId,
          includeTabsContent: true
        });

        // Generate Phase 2 requests (delete text tables, insert real tables)
        const phase2Requests = await generatePhase2TableReplacements(document.data, tableMarkers);

        if (phase2Requests.length > 0) {
          await docs.documents.batchUpdate({
            documentId: documentId,
            requestBody: { requests: phase2Requests }
          });
          console.log(`   ✓ Phase 2: Replaced text tables with real table structures`);

          // Phase 3: Read document again to find table cell indexes, then populate
          console.log(`   ⟳ Phase 3: Populating table cells...`);
          const updatedDocument = await docs.documents.get({
            documentId: documentId,
            includeTabsContent: true
          });

          const phase3Requests = generatePhase3CellPopulation(updatedDocument.data, tableMarkers);

          if (phase3Requests.length > 0) {
            await docs.documents.batchUpdate({
              documentId: documentId,
              requestBody: { requests: phase3Requests }
            });
            console.log(`   ✓ Phase 3: Populated ${tableMarkers.length} tables`);
          }
        }
      }
    }

    // Step 6: Apply document-wide styles
    await setDocumentStyles(docs, documentId);
    console.log(`   ✓ Applied document styles`);

    // Step 7: Move to parent folder if specified
    if (parentFolderId) {
      await drive.files.update({
        fileId: documentId,
        addParents: parentFolderId,
        fields: 'id, parents'
      });
      console.log(`   ✓ Moved to folder: ${parentFolderId}`);
    }

    // Step 8: Get web view link
    const file = await drive.files.get({
      fileId: documentId,
      fields: 'webViewLink'
    });

    console.log(`   ✓ Document created successfully: ${file.data.webViewLink}`);

    return {
      success: true,
      documentId: documentId,
      url: file.data.webViewLink,
      message: `Created ${documentType} for ${grantType} grant type`
    };

  } catch (error) {
    console.error(`   ✗ Failed to create document:`, error);
    return {
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    };
  }
}
