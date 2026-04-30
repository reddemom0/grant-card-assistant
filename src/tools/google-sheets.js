/**
 * Google Sheets read/write tools.
 *
 * Reuses the OAuth2 client builder from google-docs.js so we have one
 * canonical token-fetch + refresh path for Google.
 *
 * Insufficient-scope errors (users who haven't re-auth'd since the
 * spreadsheets scope was added to src/api/auth.js) are caught here and
 * returned with a friendly "log out / log in" message rather than the
 * raw Google API error.
 *
 * Heavyweight spreadsheet creation lives in google-sheets-advanced.js
 * (createAdvancedBudgetTool); this file is the lightweight read/write
 * surface.
 */

import { google } from 'googleapis';
import { getUserOAuth2Client } from './google-docs.js';
import { getBudgetTemplate, listAvailableTemplates } from './budget-templates.js';

const REAUTH_MESSAGE =
  'Google Sheets access not granted. Please log out and log in again to refresh your Google permissions.';

function isInsufficientScopeError(err) {
  // googleapis surfaces missing-scope as 403 with ACCESS_TOKEN_SCOPE_INSUFFICIENT
  // in the error message. Code can be a number (403) or a string ('403') depending
  // on the path; check both, plus regex on the message as a defensive fallback.
  const code = err?.code;
  const msg = String(err?.message ?? '');
  if (code === 403 || code === '403') {
    if (/insufficient.*scope|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(msg)) return true;
  }
  return /ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(msg);
}

function classifyError(err) {
  if (isInsufficientScopeError(err)) {
    return { success: false, error: REAUTH_MESSAGE };
  }
  return { success: false, error: err?.message ?? 'Google Sheets request failed' };
}

async function getSheetsClient(userId) {
  const auth = await getUserOAuth2Client(userId);
  return google.sheets({ version: 'v4', auth });
}

/**
 * Read cell values from an A1 range.
 * @param {number} userId
 * @param {{ spreadsheet_id: string, range: string, value_render_option?: 'FORMATTED_VALUE'|'UNFORMATTED_VALUE'|'FORMULA' }} args
 */
export async function readSheetRange(userId, args) {
  try {
    const sheets = await getSheetsClient(userId);
    const valueRenderOption = args.value_render_option || 'FORMATTED_VALUE';
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: args.spreadsheet_id,
      range: args.range,
      valueRenderOption
    });
    return {
      success: true,
      data: {
        range: resp.data.range,
        values: resp.data.values ?? [],
        value_render_option: valueRenderOption
      }
    };
  } catch (err) {
    return classifyError(err);
  }
}

/**
 * Read spreadsheet metadata (title + per-tab properties).
 * @param {number} userId
 * @param {{ spreadsheet_id: string }} args
 */
export async function readSheetMetadata(userId, args) {
  try {
    const sheets = await getSheetsClient(userId);
    const resp = await sheets.spreadsheets.get({
      spreadsheetId: args.spreadsheet_id,
      fields:
        'spreadsheetId,properties.title,sheets.properties(sheetId,title,index,gridProperties.rowCount,gridProperties.columnCount)'
    });
    const tabs = (resp.data.sheets ?? []).map(s => ({
      sheet_id: s.properties?.sheetId,
      title: s.properties?.title,
      index: s.properties?.index,
      row_count: s.properties?.gridProperties?.rowCount,
      column_count: s.properties?.gridProperties?.columnCount
    }));
    return {
      success: true,
      data: {
        spreadsheet_id: resp.data.spreadsheetId,
        title: resp.data.properties?.title,
        sheets: tabs
      }
    };
  } catch (err) {
    return classifyError(err);
  }
}

/**
 * Write a 2D array of values to an A1 range, overwriting existing content.
 * @param {number} userId
 * @param {{ spreadsheet_id: string, range: string, values: any[][], value_input_option?: 'USER_ENTERED'|'RAW' }} args
 */
export async function updateSheetRange(userId, args) {
  try {
    const sheets = await getSheetsClient(userId);
    const valueInputOption = args.value_input_option || 'USER_ENTERED';
    const resp = await sheets.spreadsheets.values.update({
      spreadsheetId: args.spreadsheet_id,
      range: args.range,
      valueInputOption,
      requestBody: { values: args.values }
    });
    return {
      success: true,
      data: {
        updated_range: resp.data.updatedRange,
        updated_rows: resp.data.updatedRows,
        updated_columns: resp.data.updatedColumns,
        updated_cells: resp.data.updatedCells
      }
    };
  } catch (err) {
    return classifyError(err);
  }
}

/**
 * Append a row at the bottom of the table covering the given range.
 * @param {number} userId
 * @param {{ spreadsheet_id: string, range: string, values: any[][], value_input_option?: 'USER_ENTERED'|'RAW' }} args
 */
export async function appendSheetRow(userId, args) {
  try {
    const sheets = await getSheetsClient(userId);
    const valueInputOption = args.value_input_option || 'USER_ENTERED';
    const resp = await sheets.spreadsheets.values.append({
      spreadsheetId: args.spreadsheet_id,
      range: args.range,
      valueInputOption,
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: args.values }
    });
    return {
      success: true,
      data: {
        updated_range: resp.data.updates?.updatedRange,
        updates: {
          updated_rows: resp.data.updates?.updatedRows,
          updated_columns: resp.data.updates?.updatedColumns,
          updated_cells: resp.data.updates?.updatedCells
        }
      }
    };
  } catch (err) {
    return classifyError(err);
  }
}

export async function createAdvancedBudget(title, userId, grantProgram, budgetData = null, parentFolderId = null) {
  try {
    console.log(`📊 Creating advanced budget: "${title}" for program: ${grantProgram}`);

    // Check if we have a pre-built template for this program
    const template = getBudgetTemplate(grantProgram);

    if (template) {
      console.log(`✓ Using pre-built template for: ${template.programName}`);
      return await createFromTemplate(title, userId, template, budgetData, parentFolderId);
    } else {
      console.log(`⚠️  No pre-built template found. Using dynamic generation for: ${grantProgram}`);
      return await createDynamicBudget(title, userId, grantProgram, budgetData, parentFolderId);
    }

  } catch (error) {
    console.error('Advanced budget creation error:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Create budget from pre-built template
 * @private
 */
async function createFromTemplate(title, userId, template, budgetData, parentFolderId) {
  console.log(`Building budget from ${template.programName} template...`);

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

  const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
  const drive = google.drive({ version: 'v3', auth: oauth2Client });

  // Create spreadsheet with all template sheets
  const sheetProperties = template.sheets.map(sheet => ({
    properties: {
      title: sheet.name,
      gridProperties: {
        frozenRowCount: sheet.frozenRows || 0,
        frozenColumnCount: sheet.frozenColumns || 0
      }
    }
  }));

  const spreadsheet = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: title },
      sheets: sheetProperties
    }
  });

  const spreadsheetId = spreadsheet.data.spreadsheetId;
  console.log(`✓ Created spreadsheet: ${spreadsheetId}`);

  // Populate each sheet based on template configuration
  console.log('Populating sheets...');

  for (let i = 0; i < template.sheets.length; i++) {
    const sheetConfig = template.sheets[i];
    const sheetId = spreadsheet.data.sheets[i].properties.sheetId;

    console.log(`  → Populating ${sheetConfig.name} (${sheetConfig.type})`);

    try {
      await populateSheet(sheets, spreadsheetId, sheetId, sheetConfig, template);
    } catch (error) {
      console.error(`  ✗ Error populating ${sheetConfig.name}:`, error.message);
    }
  }

  console.log('✓ All sheets populated');

  // Move to parent folder if specified
  if (parentFolderId) {
    await drive.files.update({
      fileId: spreadsheetId,
      addParents: parentFolderId,
      fields: 'id, parents'
    });
    console.log(`✓ Moved to folder: ${parentFolderId}`);
  }

  // Get web view link
  const file = await drive.files.get({
    fileId: spreadsheetId,
    fields: 'webViewLink'
  });

  console.log(`✓ Advanced budget created: ${title}`);

  return {
    success: true,
    sheet: {
      id: spreadsheetId,
      title: title,
      url: file.data.webViewLink,
      template: template.programName
    }
  };
}

/**
 * Populate a sheet based on its type and configuration
 * @private
 */
async function populateSheet(sheets, spreadsheetId, sheetId, sheetConfig, template) {
  const requests = [];

  switch (sheetConfig.type) {
    case 'instructions':
      requests.push(...createInstructionsSheet(sheetConfig, sheetId));
      break;
    case 'budget':
      requests.push(...createBudgetSheet(sheetConfig, sheetId));
      break;
    case 'reference':
      requests.push(...createReferenceSheet(sheetConfig, sheetId, template));
      break;
    case 'export_sales':
      requests.push(...createExportSalesSheet(sheetConfig, sheetId));
      break;
    case 'targets':
      requests.push(...createTargetsSheet(sheetConfig, sheetId));
      break;
    case 'claims':
      requests.push(...createClaimsSheet(sheetConfig, sheetId));
      break;
    case 'quote':
      requests.push(...createQuoteSheet(sheetConfig, sheetId));
      break;
    default:
      console.log(`    ⚠️  Unknown sheet type: ${sheetConfig.type}`);
      return;
  }

  if (requests.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests }
    });
  }
}

/**
 * Create Instructions sheet
 * @private
 */
function createInstructionsSheet(sheetConfig, sheetId) {
  const requests = [];
  const content = sheetConfig.content;

  let row = 0;

  // Title
  requests.push({
    updateCells: {
      range: {
        sheetId,
        startRowIndex: row,
        endRowIndex: row + 1,
        startColumnIndex: 0,
        endColumnIndex: 8
      },
      rows: [{
        values: [{
          userEnteredValue: { stringValue: content.title },
          userEnteredFormat: {
            textFormat: { bold: true, fontSize: 14 },
            horizontalAlignment: 'LEFT'
          }
        }]
      }],
      fields: 'userEnteredValue,userEnteredFormat'
    }
  });

  row += 2;

  // Sections
  if (content.sections) {
    for (const section of content.sections) {
      // Section header
      requests.push({
        updateCells: {
          range: {
            sheetId,
            startRowIndex: row,
            endRowIndex: row + 1,
            startColumnIndex: 0,
            endColumnIndex: 1
          },
          rows: [{
            values: [{
              userEnteredValue: { stringValue: section.header },
              userEnteredFormat: {
                textFormat: { bold: true },
                backgroundColor: { red: 0.9, green: 0.9, blue: 0.9 }
              }
            }]
          }],
          fields: 'userEnteredValue,userEnteredFormat'
        }
      });

      row++;

      // Instructions
      for (const instruction of section.instructions) {
        requests.push({
          updateCells: {
            range: {
              sheetId,
              startRowIndex: row,
              endRowIndex: row + 1,
              startColumnIndex: 0,
              endColumnIndex: 8
            },
            rows: [{
              values: [{
                userEnteredValue: { stringValue: instruction },
                userEnteredFormat: { wrapStrategy: 'WRAP' }
              }]
            }],
            fields: 'userEnteredValue,userEnteredFormat'
          }
        });
        row++;
      }

      row += 1; // Space between sections
    }
  } else if (content.instructions) {
    // Simple list format
    for (const instruction of content.instructions) {
      requests.push({
        updateCells: {
          range: {
            sheetId,
            startRowIndex: row,
            endRowIndex: row + 1,
            startColumnIndex: 0,
            endColumnIndex: 8
          },
          rows: [{
            values: [{
              userEnteredValue: { stringValue: instruction },
              userEnteredFormat: { wrapStrategy: 'WRAP' }
            }]
          }],
          fields: 'userEnteredValue,userEnteredFormat'
        }
      });
      row++;
    }
  } else {
    // Default instructions when none provided
    const defaultInstructions = [
      '1. Fill in the Project Activity column with specific tasks and deliverables',
      '2. Provide detailed descriptions for each activity',
      '3. Specify timeline or project phase for each item',
      '4. Enter estimated costs in CAD dollars',
      '5. Review funding percentages for each category (varies by program)',
      '6. Ensure all R&D-related activities are properly documented',
      '7. Keep detailed records and receipts for all expenses',
      '8. Submit claims according to program requirements',
      '',
      'Note: Consult with your program advisor to confirm eligible expenses and funding rates.'
    ];

    for (const instruction of defaultInstructions) {
      requests.push({
        updateCells: {
          range: {
            sheetId,
            startRowIndex: row,
            endRowIndex: row + 1,
            startColumnIndex: 0,
            endColumnIndex: 8
          },
          rows: [{
            values: [{
              userEnteredValue: { stringValue: instruction },
              userEnteredFormat: { wrapStrategy: 'WRAP' }
            }]
          }],
          fields: 'userEnteredValue,userEnteredFormat'
        }
      });
      row++;
    }
  }

  return requests;
}

/**
 * Create Budget sheet with headers and category rows
 * @private
 */
function createBudgetSheet(sheetConfig, sheetId) {
  const requests = [];

  // Add column headers
  const headerRow = sheetConfig.columns.map(col => ({
    userEnteredValue: { stringValue: col.header },
    userEnteredFormat: {
      textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
      backgroundColor: { red: 0.2, green: 0.5, blue: 0.8 },
      horizontalAlignment: 'CENTER',
      wrapStrategy: 'WRAP'
    }
  }));

  requests.push({
    updateCells: {
      range: {
        sheetId,
        startRowIndex: 0,
        endRowIndex: 1,
        startColumnIndex: 0,
        endColumnIndex: sheetConfig.columns.length
      },
      rows: [{ values: headerRow }],
      fields: 'userEnteredValue,userEnteredFormat'
    }
  });

  // Set column widths
  for (let i = 0; i < sheetConfig.columns.length; i++) {
    const col = sheetConfig.columns[i];
    if (col.width) {
      requests.push({
        updateDimensionProperties: {
          range: {
            sheetId,
            dimension: 'COLUMNS',
            startIndex: i,
            endIndex: i + 1
          },
          properties: {
            pixelSize: col.width
          },
          fields: 'pixelSize'
        }
      });
    }
  }

  // Add category rows if defined
  if (sheetConfig.categories) {
    let row = 1;

    for (const category of sheetConfig.categories) {
      const categoryName = category.name || '';

      const description = [
        category.description,
        category.includes ? `Includes: ${category.includes}` : null,
        category.excludes ? `Excludes: ${category.excludes}` : null
      ].filter(Boolean).join('\n');

      const rowValues = [{
        userEnteredValue: { stringValue: categoryName },
        userEnteredFormat: {
          textFormat: { bold: true }
        }
      }, {
        userEnteredValue: { stringValue: description },
        userEnteredFormat: {
          wrapStrategy: 'WRAP',
          textFormat: { fontSize: 9 }
        }
      }, {
        userEnteredValue: { stringValue: '' }
      }];

      // Fill remaining columns with empty cells
      while (rowValues.length < sheetConfig.columns.length) {
        rowValues.push({ userEnteredValue: { stringValue: '' } });
      }

      requests.push({
        updateCells: {
          range: {
            sheetId,
            startRowIndex: row,
            endRowIndex: row + 1,
            startColumnIndex: 0,
            endColumnIndex: sheetConfig.columns.length
          },
          rows: [{ values: rowValues }],
          fields: 'userEnteredValue,userEnteredFormat'
        }
      });

      row++;

      // Add subcategory rows
      if (category.subcategories) {
        for (const sub of category.subcategories) {
          const subRowValues = [{
            userEnteredValue: { stringValue: '' }
          }, {
            userEnteredValue: { stringValue: '' }
          }, {
            userEnteredValue: { stringValue: sub },
            userEnteredFormat: {
              wrapStrategy: 'WRAP',
              textFormat: { fontSize: 9, italic: true }
            }
          }];

          while (subRowValues.length < sheetConfig.columns.length) {
            subRowValues.push({ userEnteredValue: { stringValue: '' } });
          }

          requests.push({
            updateCells: {
              range: {
                sheetId,
                startRowIndex: row,
                endRowIndex: row + 1,
                startColumnIndex: 0,
                endColumnIndex: sheetConfig.columns.length
              },
              rows: [{ values: subRowValues }],
              fields: 'userEnteredValue,userEnteredFormat'
            }
          });

          row++;
        }
      }
    }
  }

  return requests;
}

/**
 * Create Reference sheet (Eligible/Ineligible Activities)
 * @private
 */
function createReferenceSheet(sheetConfig, sheetId, template) {
  const requests = [];

  // Title
  const title = sheetConfig.name;
  requests.push({
    updateCells: {
      range: {
        sheetId,
        startRowIndex: 0,
        endRowIndex: 1,
        startColumnIndex: 0,
        endColumnIndex: 1
      },
      rows: [{
        values: [{
          userEnteredValue: { stringValue: title },
          userEnteredFormat: {
            textFormat: { bold: true, fontSize: 14 }
          }
        }]
      }],
      fields: 'userEnteredValue,userEnteredFormat'
    }
  });

  let row = 2;

  // For Eligible Activities
  if (title.toLowerCase().includes('eligible') && !title.toLowerCase().includes('ineligible')) {
    const categories = template.sheets.find(s => s.type === 'budget')?.categories || [];

    for (const category of categories) {
      // Category header
      const categoryHeader = category.code
        ? `Category ${category.code}: ${category.name}`
        : category.name;

      requests.push({
        updateCells: {
          range: {
            sheetId,
            startRowIndex: row,
            endRowIndex: row + 1,
            startColumnIndex: 0,
            endColumnIndex: 1
          },
          rows: [{
            values: [{
              userEnteredValue: { stringValue: categoryHeader },
              userEnteredFormat: {
                textFormat: { bold: true },
                backgroundColor: { red: 0.85, green: 0.92, blue: 0.83 }
              }
            }]
          }],
          fields: 'userEnteredValue,userEnteredFormat'
        }
      });

      row++;

      // Description
      requests.push({
        updateCells: {
          range: {
            sheetId,
            startRowIndex: row,
            endRowIndex: row + 1,
            startColumnIndex: 0,
            endColumnIndex: 4
          },
          rows: [{
            values: [{
              userEnteredValue: { stringValue: category.description },
              userEnteredFormat: { wrapStrategy: 'WRAP' }
            }]
          }],
          fields: 'userEnteredValue,userEnteredFormat'
        }
      });

      row++;

      // Includes
      if (category.includes) {
        requests.push({
          updateCells: {
            range: {
              sheetId,
              startRowIndex: row,
              endRowIndex: row + 1,
              startColumnIndex: 0,
              endColumnIndex: 4
            },
            rows: [{
              values: [{
                userEnteredValue: { stringValue: `✓ Includes: ${category.includes}` },
                userEnteredFormat: {
                  wrapStrategy: 'WRAP',
                  textFormat: { foregroundColor: { red: 0, green: 0.6, blue: 0 } }
                }
              }]
            }],
            fields: 'userEnteredValue,userEnteredFormat'
          }
        });
        row++;
      }

      // Excludes
      if (category.excludes) {
        requests.push({
          updateCells: {
            range: {
              sheetId,
              startRowIndex: row,
              endRowIndex: row + 1,
              startColumnIndex: 0,
              endColumnIndex: 4
            },
            rows: [{
              values: [{
                userEnteredValue: { stringValue: `✗ Excludes: ${category.excludes}` },
                userEnteredFormat: {
                  wrapStrategy: 'WRAP',
                  textFormat: { foregroundColor: { red: 0.8, green: 0, blue: 0 } }
                }
              }]
            }],
            fields: 'userEnteredValue,userEnteredFormat'
          }
        });
        row++;
      }

      // Subcategories
      if (category.subcategories) {
        for (const sub of category.subcategories) {
          requests.push({
            updateCells: {
              range: {
                sheetId,
                startRowIndex: row,
                endRowIndex: row + 1,
                startColumnIndex: 0,
                endColumnIndex: 4
              },
              rows: [{
                values: [{
                  userEnteredValue: { stringValue: `  • ${sub}` },
                  userEnteredFormat: {
                    wrapStrategy: 'WRAP',
                    textFormat: { italic: true }
                  }
                }]
              }],
              fields: 'userEnteredValue,userEnteredFormat'
            }
          });
          row++;
        }
      }

      row += 1; // Space between categories
    }
  }

  // For Ineligible Activities
  else if (title.toLowerCase().includes('ineligible')) {
    const ineligibleList = [
      { category: 'Land & Building Purchase', reason: 'Capital asset purchases not eligible' },
      { category: 'Existing Debt', reason: 'Refinancing or paying off existing loans' },
      { category: 'Operating Expenses (General)', reason: 'General overhead not directly related to project' },
      { category: 'Entertainment', reason: 'Entertainment expenses not project-related' },
      { category: 'Political Activities', reason: 'Lobbying or political contributions' },
      { category: 'Contingencies', reason: 'Unspecified contingency reserves' },
      { category: 'Interest & Bank Charges', reason: 'Financing costs and interest payments' },
      { category: 'Depreciation', reason: 'Depreciation of assets' },
      { category: 'Previous Project Costs', reason: 'Expenses incurred before project approval' },
      { category: 'GST/HST (Recoverable)', reason: 'Taxes that can be recovered through input tax credits' }
    ];

    // Header row
    requests.push({
      updateCells: {
        range: {
          sheetId,
          startRowIndex: row,
          endRowIndex: row + 1,
          startColumnIndex: 0,
          endColumnIndex: 2
        },
        rows: [{
          values: [
            {
              userEnteredValue: { stringValue: 'Expense Category' },
              userEnteredFormat: {
                textFormat: { bold: true },
                backgroundColor: { red: 0.95, green: 0.8, blue: 0.8 }
              }
            },
            {
              userEnteredValue: { stringValue: 'Reason' },
              userEnteredFormat: {
                textFormat: { bold: true },
                backgroundColor: { red: 0.95, green: 0.8, blue: 0.8 }
              }
            }
          ]
        }],
        fields: 'userEnteredValue,userEnteredFormat'
      }
    });

    row++;

    // Ineligible items
    for (const item of ineligibleList) {
      requests.push({
        updateCells: {
          range: {
            sheetId,
            startRowIndex: row,
            endRowIndex: row + 1,
            startColumnIndex: 0,
            endColumnIndex: 2
          },
          rows: [{
            values: [
              {
                userEnteredValue: { stringValue: item.category },
                userEnteredFormat: { wrapStrategy: 'WRAP' }
              },
              {
                userEnteredValue: { stringValue: item.reason },
                userEnteredFormat: { wrapStrategy: 'WRAP' }
              }
            ]
          }],
          fields: 'userEnteredValue,userEnteredFormat'
        }
      });
      row++;
    }
  }

  // Set column widths for reference sheets
  requests.push({
    updateDimensionProperties: {
      range: {
        sheetId,
        dimension: 'COLUMNS',
        startIndex: 0,
        endIndex: 1
      },
      properties: {
        pixelSize: 300
      },
      fields: 'pixelSize'
    }
  }, {
    updateDimensionProperties: {
      range: {
        sheetId,
        dimension: 'COLUMNS',
        startIndex: 1,
        endIndex: 2
      },
      properties: {
        pixelSize: 400
      },
      fields: 'pixelSize'
    }
  });

  return requests;
}

/**
 * Create Export Sales sheet
 * @private
 */
function createExportSalesSheet(sheetConfig, sheetId) {
  const requests = [];

  // Add column headers
  const headerRow = sheetConfig.columns.map(col => ({
    userEnteredValue: { stringValue: col.header },
    userEnteredFormat: {
      textFormat: { bold: true },
      backgroundColor: { red: 0.85, green: 0.85, blue: 0.85 }
    }
  }));

  requests.push({
    updateCells: {
      range: {
        sheetId,
        startRowIndex: 0,
        endRowIndex: 1,
        startColumnIndex: 0,
        endColumnIndex: sheetConfig.columns.length
      },
      rows: [{ values: headerRow }],
      fields: 'userEnteredValue,userEnteredFormat'
    }
  });

  // Set column widths
  for (let i = 0; i < sheetConfig.columns.length; i++) {
    const col = sheetConfig.columns[i];
    if (col.width) {
      requests.push({
        updateDimensionProperties: {
          range: {
            sheetId,
            dimension: 'COLUMNS',
            startIndex: i,
            endIndex: i + 1
          },
          properties: {
            pixelSize: col.width
          },
          fields: 'pixelSize'
        }
      });
    }
  }

  return requests;
}

/**
 * Create Targets sheet
 * @private
 */
function createTargetsSheet(sheetConfig, sheetId) {
  const requests = [];

  // Add column headers
  const headerRow = sheetConfig.columns.map(col => ({
    userEnteredValue: { stringValue: col.header },
    userEnteredFormat: {
      textFormat: { bold: true },
      backgroundColor: { red: 0.85, green: 0.85, blue: 0.85 }
    }
  }));

  requests.push({
    updateCells: {
      range: {
        sheetId,
        startRowIndex: 0,
        endRowIndex: 1,
        startColumnIndex: 0,
        endColumnIndex: sheetConfig.columns.length
      },
      rows: [{ values: headerRow }],
      fields: 'userEnteredValue,userEnteredFormat'
    }
  });

  // Add numbered rows
  if (sheetConfig.rowCount) {
    for (let i = 1; i <= sheetConfig.rowCount; i++) {
      requests.push({
        updateCells: {
          range: {
            sheetId,
            startRowIndex: i,
            endRowIndex: i + 1,
            startColumnIndex: 0,
            endColumnIndex: 1
          },
          rows: [{
            values: [{
              userEnteredValue: { numberValue: i }
            }]
          }],
          fields: 'userEnteredValue'
        }
      });
    }
  }

  // Set column widths
  for (let i = 0; i < sheetConfig.columns.length; i++) {
    const col = sheetConfig.columns[i];
    if (col.width) {
      requests.push({
        updateDimensionProperties: {
          range: {
            sheetId,
            dimension: 'COLUMNS',
            startIndex: i,
            endIndex: i + 1
          },
          properties: {
            pixelSize: col.width
          },
          fields: 'pixelSize'
        }
      });
    }
  }

  return requests;
}

/**
 * Create Claims sheet
 * @private
 */
function createClaimsSheet(sheetConfig, sheetId) {
  const requests = [];

  // Add column headers
  const headerRow = sheetConfig.columns.map(col => ({
    userEnteredValue: { stringValue: col.header },
    userEnteredFormat: {
      textFormat: { bold: true },
      backgroundColor: { red: 0.3, green: 0.6, blue: 0.9 },
      horizontalAlignment: 'CENTER',
      wrapStrategy: 'WRAP'
    }
  }));

  requests.push({
    updateCells: {
      range: {
        sheetId,
        startRowIndex: 0,
        endRowIndex: 1,
        startColumnIndex: 0,
        endColumnIndex: sheetConfig.columns.length
      },
      rows: [{ values: headerRow }],
      fields: 'userEnteredValue,userEnteredFormat'
    }
  });

  // Set column widths
  for (let i = 0; i < sheetConfig.columns.length; i++) {
    const col = sheetConfig.columns[i];
    if (col.width) {
      requests.push({
        updateDimensionProperties: {
          range: {
            sheetId,
            dimension: 'COLUMNS',
            startIndex: i,
            endIndex: i + 1
          },
          properties: {
            pixelSize: col.width
          },
          fields: 'pixelSize'
        }
      });
    }
  }

  return requests;
}

/**
 * Create Quote sheet
 * @private
 */
function createQuoteSheet(sheetConfig, sheetId) {
  const requests = [];

  // Add instruction text
  requests.push({
    updateCells: {
      range: {
        sheetId,
        startRowIndex: 1,
        endRowIndex: 2,
        startColumnIndex: 0,
        endColumnIndex: 1
      },
      rows: [{
        values: [{
          userEnteredValue: { stringValue: sheetConfig.instructions || 'Please paste quote image or text below.' },
          userEnteredFormat: {
            textFormat: { italic: true }
          }
        }]
      }],
      fields: 'userEnteredValue,userEnteredFormat'
    }
  });

  return requests;
}

/**
 * Create budget dynamically for programs without pre-built templates
 * ALWAYS includes Eligible and Ineligible Activities sheets
 * @private
 */
async function createDynamicBudget(title, userId, grantProgram, budgetData, parentFolderId) {
  console.log(`Dynamically generating budget for: ${grantProgram}`);

  // If no budget data provided, use fallback to simple budget
  if (!budgetData || !budgetData.sheets) {
    console.log('  ⚠️  No budget structure provided, using simple fallback');
    return await createGoogleSheet(title, userId, parentFolderId, grantProgram);
  }

  // Build dynamic template from budgetData
  const dynamicTemplate = {
    programName: grantProgram,
    sheets: budgetData.sheets
  };

  console.log(`  ✓ Using custom budget structure with ${dynamicTemplate.sheets.length} sheets`);

  // Ensure Eligible and Ineligible sheets exist
  const hasEligible = dynamicTemplate.sheets.some(s =>
    s.name.toLowerCase().includes('eligible') && !s.name.toLowerCase().includes('ineligible')
  );
  const hasIneligible = dynamicTemplate.sheets.some(s =>
    s.name.toLowerCase().includes('ineligible')
  );

  if (!hasEligible) {
    console.log('  ⚠️  Adding missing Eligible Activities sheet');
    dynamicTemplate.sheets.push({
      name: 'Eligible Activities',
      type: 'reference',
      content: { title: 'Eligible Expense Categories' }
    });
  }

  if (!hasIneligible) {
    console.log('  ⚠️  Adding missing Ineligible Activities sheet');
    dynamicTemplate.sheets.push({
      name: 'Ineligible Activities',
      type: 'reference',
      content: { title: 'Ineligible Expenses' }
    });
  }

  // Use the same creation logic as pre-built templates
  return await createFromTemplate(title, userId, dynamicTemplate, budgetData, parentFolderId);
}
