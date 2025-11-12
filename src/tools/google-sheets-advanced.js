/**
 * Advanced Google Sheets Tool Executor
 * Wrapper for createAdvancedBudget to work with the tool registry system
 */

import { createAdvancedBudget } from './google-sheets.js';

/**
 * Create advanced budget spreadsheet with program-specific templates
 * @param {object} input - Tool input parameters
 * @param {object} context - Execution context (userId, conversationId, etc.)
 * @returns {Promise<object>} Creation result
 */
export async function createAdvancedBudgetTool(input, context) {
  const { title, grantProgram, budgetData, parentFolderId } = input;
  const { userId } = context;

  if (!userId) {
    throw new Error('User ID is required to create Google Sheets');
  }

  if (!title) {
    throw new Error('Sheet title is required');
  }

  if (!grantProgram) {
    throw new Error('Grant program name is required');
  }

  console.log(`📊 Creating advanced budget: "${title}" for program: ${grantProgram}`);

  try {
    const result = await createAdvancedBudget(
      title,
      userId,
      grantProgram,
      budgetData,
      parentFolderId
    );

    console.log(`✅ Advanced budget created successfully: ${result.spreadsheetUrl}`);

    return {
      success: true,
      spreadsheetId: result.spreadsheetId,
      spreadsheetUrl: result.spreadsheetUrl,
      sheetsCreated: result.sheetsCreated,
      message: `Created ${result.sheetsCreated.length}-sheet budget template for ${grantProgram}`
    };
  } catch (error) {
    console.error(`❌ Failed to create advanced budget:`, error);
    throw new Error(`Failed to create advanced budget: ${error.message}`);
  }
}
