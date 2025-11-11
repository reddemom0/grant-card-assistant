/**
 * Google Sheets Integration Tools
 *
 * Provides functionality to create and manage Google Sheets including:
 * - Create spreadsheets with multiple tabs
 * - Pre-populate budget templates (simple and complex)
 * - Format cells and apply styles
 * - Support program-specific budget templates (CanExport, RTRI, BCAFE, etc.)
 */

import { google } from 'googleapis';
import { getBudgetTemplate, listAvailableTemplates } from './budget-templates.js';

/**
 * Create a new Google Sheet with budget template
 * @param {string} title - Sheet title
 * @param {number} userId - User ID (for OAuth-based access)
 * @param {string} parentFolderId - Optional: Parent folder ID to place sheet in
 * @param {string} grantProgram - Optional: Grant program name for eligible expenses
 * @returns {Object} Created sheet information
 */
export async function createGoogleSheet(title, userId, parentFolderId = null, grantProgram = null) {
  try {
    console.log(`Creating Google Sheet: "${title}" for user ID: ${userId}`);

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

    // Create Sheets API client
    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    // Create the spreadsheet with 2 tabs
    const spreadsheet = await sheets.spreadsheets.create({
      requestBody: {
        properties: {
          title: title
        },
        sheets: [
          {
            properties: {
              title: 'Eligible Expenses',
              gridProperties: {
                frozenRowCount: 1
              }
            }
          },
          {
            properties: {
              title: 'Ineligible Expenses',
              gridProperties: {
                frozenRowCount: 1
              }
            }
          }
        ]
      }
    });

    const spreadsheetId = spreadsheet.data.spreadsheetId;
    console.log(`✓ Created spreadsheet with ID: ${spreadsheetId}`);

    // Get sheet IDs for formatting
    const eligibleSheetId = spreadsheet.data.sheets[0].properties.sheetId;
    const ineligibleSheetId = spreadsheet.data.sheets[1].properties.sheetId;

    // Prepare eligible expenses based on grant program
    const eligibleExpenses = getEligibleExpenses(grantProgram);
    const ineligibleExpenses = getIneligibleExpenses(grantProgram);

    // Build batch update request for formatting and data
    const requests = [
      // Format Eligible Expenses tab header
      {
        repeatCell: {
          range: {
            sheetId: eligibleSheetId,
            startRowIndex: 0,
            endRowIndex: 1
          },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.2, green: 0.5, blue: 0.8 },
              textFormat: {
                foregroundColor: { red: 1, green: 1, blue: 1 },
                bold: true
              },
              horizontalAlignment: 'LEFT'
            }
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'
        }
      },
      // Format Ineligible Expenses tab header
      {
        repeatCell: {
          range: {
            sheetId: ineligibleSheetId,
            startRowIndex: 0,
            endRowIndex: 1
          },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.8, green: 0.3, blue: 0.3 },
              textFormat: {
                foregroundColor: { red: 1, green: 1, blue: 1 },
                bold: true
              },
              horizontalAlignment: 'LEFT'
            }
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'
        }
      }
    ];

    // Apply formatting
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: spreadsheetId,
      requestBody: { requests }
    });

    // Populate Eligible Expenses tab
    await sheets.spreadsheets.values.update({
      spreadsheetId: spreadsheetId,
      range: 'Eligible Expenses!A1',
      valueInputOption: 'RAW',
      requestBody: {
        values: [
          ['Expense Category', 'Description', 'Amount ($)', 'Notes'],
          ...eligibleExpenses.map(exp => [exp.category, exp.description, '', ''])
        ]
      }
    });

    // Populate Ineligible Expenses tab
    await sheets.spreadsheets.values.update({
      spreadsheetId: spreadsheetId,
      range: 'Ineligible Expenses!A1',
      valueInputOption: 'RAW',
      requestBody: {
        values: [
          ['Expense Category', 'Reason'],
          ...ineligibleExpenses.map(exp => [exp.category, exp.reason])
        ]
      }
    });

    console.log('✓ Populated expense data');

    // Move to parent folder if specified
    if (parentFolderId) {
      await drive.files.update({
        fileId: spreadsheetId,
        addParents: parentFolderId,
        fields: 'id, parents'
      });
      console.log(`✓ Moved sheet to folder: ${parentFolderId}`);
    }

    // Get web view link
    const file = await drive.files.get({
      fileId: spreadsheetId,
      fields: 'webViewLink'
    });

    console.log(`✓ Google Sheet created: ${title} (${spreadsheetId})`);

    return {
      success: true,
      sheet: {
        id: spreadsheetId,
        title: title,
        url: file.data.webViewLink
      }
    };

  } catch (error) {
    console.error('Google Sheets creation error:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get eligible expenses based on grant program
 * @param {string} grantProgram - Grant program name
 * @returns {Array} List of eligible expense categories
 */
function getEligibleExpenses(grantProgram) {
  // Default eligible expenses that apply to most BC innovation grants
  const defaultExpenses = [
    { category: 'Personnel Costs', description: 'Salaries, wages, benefits for project staff' },
    { category: 'Professional Services', description: 'Consultants, contractors, professional fees' },
    { category: 'Equipment & Materials', description: 'Project-specific equipment and supplies' },
    { category: 'Marketing & Promotion', description: 'Marketing materials, advertising, promotional activities' },
    { category: 'Travel', description: 'Business travel related to project activities' },
    { category: 'Training & Development', description: 'Training programs, workshops, courses' },
    { category: 'Technology & Software', description: 'Software licenses, cloud services, IT infrastructure' },
    { category: 'Research & Development', description: 'R&D activities, prototyping, testing' },
    { category: 'Facility Costs', description: 'Rent, utilities, project-specific facility expenses' },
    { category: 'Other Eligible Expenses', description: 'Other expenses approved by program guidelines' }
  ];

  // Program-specific expenses can be added here
  const programSpecific = {
    'BCIC Ignite': [
      { category: 'Product Development', description: 'Product design, prototyping, testing' },
      { category: 'Market Research', description: 'Market analysis, customer discovery, competitive research' },
      { category: 'IP Development', description: 'Patent applications, trademark registration, IP strategy' }
    ],
    'ETG': [
      { category: 'Training Materials', description: 'Development of training curriculum and materials' },
      { category: 'Trainer Fees', description: 'Costs for external trainers or training facilitators' },
      { category: 'Employee Wages During Training', description: 'Wages paid to employees during training time' }
    ]
  };

  const specific = programSpecific[grantProgram] || [];
  return [...specific, ...defaultExpenses];
}

/**
 * Get ineligible expenses based on grant program
 * @param {string} grantProgram - Grant program name
 * @returns {Array} List of ineligible expense categories
 */
function getIneligibleExpenses(grantProgram) {
  return [
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
}

/**
 * Create an advanced budget spreadsheet using program-specific templates
 * Supports both pre-built templates (CanExport, RTRI, BCAFE) and dynamic generation
 *
 * IMPORTANT: ALL budgets must include Eligible and Ineligible Activities reference sheets
 *
 * @param {string} title - Budget title
 * @param {number} userId - User ID for OAuth
 * @param {string} grantProgram - Grant program name
 * @param {Object} budgetData - Budget structure data (for dynamic generation)
 * @param {string} parentFolderId - Optional folder ID
 * @returns {Object} Created budget information
 */
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
      const categoryText = category.code
        ? `${category.code} | ${category.name}`
        : category.name;

      const description = [
        category.description,
        category.includes ? `Includes: ${category.includes}` : null,
        category.excludes ? `Excludes: ${category.excludes}` : null
      ].filter(Boolean).join('\n');

      const rowValues = [{
        userEnteredValue: { stringValue: category.code || '' }
      }, {
        userEnteredValue: { stringValue: '' }
      }, {
        userEnteredValue: { stringValue: description },
        userEnteredFormat: {
          wrapStrategy: 'WRAP',
          textFormat: { fontSize: 9 }
        }
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

  // For now, fall back to the simple budget creation
  // but ensure it ALWAYS includes Eligible and Ineligible sheets

  // TODO: Implement full dynamic budget generation that:
  // 1. Extracts budget structure from budgetData
  // 2. Creates appropriate sheets based on program requirements
  // 3. ALWAYS includes Eligible Activities sheet
  // 4. ALWAYS includes Ineligible Activities sheet
  // 5. Formats and populates based on program-specific rules

  return await createGoogleSheet(title, userId, parentFolderId, grantProgram);
}
