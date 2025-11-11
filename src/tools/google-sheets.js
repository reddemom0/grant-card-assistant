/**
 * Google Sheets Integration Tools
 *
 * Provides functionality to create and manage Google Sheets including:
 * - Create spreadsheets with multiple tabs
 * - Pre-populate budget templates
 * - Format cells and apply styles
 */

import { google } from 'googleapis';

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
