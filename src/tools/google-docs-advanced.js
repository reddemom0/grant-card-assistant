/**
 * Advanced Google Docs Formatting for Granted Consulting
 * Creates documents with specific branding and layout
 */

import { google } from 'googleapis';
import { getTemplate } from './doc-templates/index.js';
import { createGoogleDocFromTemplate } from './google-docs-construction.js';

/**
 * Logo URL - can be overridden via GRANTED_LOGO_URL environment variable
 * For now using a direct Google Drive link (update this after uploading logo)
 */
const LOGO_URL = process.env.GRANTED_LOGO_URL || 'https://drive.google.com/uc?export=view&id=PLACEHOLDER';

/**
 * Brand colors (Granted Consulting)
 */
const BRAND_COLORS = {
  // Dark blue 2 for headers (RGB: 0, 71, 171)
  HEADER_BLUE: {
    color: {
      rgbColor: {
        red: 0,
        green: 0.278,  // 71/255
        blue: 0.671    // 171/255
      }
    }
  },
  // Dark gray 3 for title text (RGB: 102, 102, 102)
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
 * After Phase 2 creates empty table structures, this fills them with content
 * @param {Object} document - Updated document after Phase 2
 * @param {Array} tableMarkers - Table metadata from Phase 1
 * @returns {Array} Array of insertText and formatting requests
 */
function generatePhase3CellPopulation(document, tableMarkers) {
  const requests = [];
  const body = document.tabs?.[0]?.documentTab?.body || document.body;

  // Extract all tables from document
  const tables = body.content.filter(el => el.table);

  console.log(`   📊 Found ${tables.length} tables in document, populating ${Math.min(tables.length, tableMarkers.length)}...`);

  // Populate each table with its corresponding data
  for (let tableIndex = 0; tableIndex < Math.min(tables.length, tableMarkers.length); tableIndex++) {
    const tableElement = tables[tableIndex];
    const tableInfo = tableMarkers[tableIndex];
    const table = tableElement.table;

    if (!table || !table.tableRows) {
      console.log(`   ⚠️  Table ${tableIndex}: Missing table or tableRows`);
      continue;
    }

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

        const insertIndex = cellContent.startIndex + 1; // +1 to insert inside paragraph

        // Insert header text
        requests.push({
          insertText: {
            location: { index: insertIndex },
            text: tableInfo.headers[col]
          }
        });

        // Make header bold
        requests.push({
          updateTextStyle: {
            range: {
              startIndex: insertIndex,
              endIndex: insertIndex + tableInfo.headers[col].length
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

        const insertIndex = cellContent.startIndex + 1;

        requests.push({
          insertText: {
            location: { index: insertIndex },
            text: rowData[col]
          }
        });
      }
    }
  }

  console.log(`   ✓ Generated ${requests.length} cell population requests`);

  // Return requests in reverse order (write backwards pattern)
  return requests.reverse();
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

export async function createAdvancedDocumentTool(input, context) {
  const { title, grantType, documentType, data = {}, parentFolderId } = input;
  const { userId } = context || {};

  console.log(`📄 Creating advanced document: ${title}`);
  console.log(`   Grant Type: ${grantType}`);
  console.log(`   Document Type: ${documentType}`);
  console.log(`   User ID: ${userId}`);

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

    // Get template
    const template = getTemplate(grantType, documentType);
    if (!template) {
      return {
        success: false,
        error: `No template found for grant type "${grantType}" and document type "${documentType}"`
      };
    }

    console.log(`   ✓ Template found`);

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
