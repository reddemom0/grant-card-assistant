#!/usr/bin/env node
/**
 * Program Card Generator - Dropbox Edition
 *
 * Generates structured program cards from raw Dropbox documentation.
 * Fetches files directly from Dropbox API (no local filesystem needed).
 *
 * Usage:
 *   node scripts/generate-program-card.js --program "Program Name" --dropbox-path "/Granted Team Folder/SALES/Grants/DS4Y - Pinnguaq"
 *
 * Options:
 *   --program        Program name (e.g., "WorkBC Wage Subsidy", "Digital WIL")
 *   --dropbox-path   Dropbox path to folder containing program documentation
 *   --output         Optional output path (defaults to programs/generated/[program-id].md)
 */

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import mammoth from 'mammoth';
import xlsx from 'xlsx';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Dropbox credentials
const DROPBOX_REFRESH_TOKEN = process.env.DROPBOX_REFRESH_TOKEN;
const DROPBOX_APP_KEY = process.env.DROPBOX_APP_KEY;
const DROPBOX_APP_SECRET = process.env.DROPBOX_APP_SECRET;
const DROPBOX_NAMESPACE_ID = process.env.DROPBOX_NAMESPACE_ID;

let currentAccessToken = null;
let tokenExpiry = 0;

/**
 * Refresh Dropbox access token
 */
async function refreshDropboxToken() {
  console.log('🔄 Refreshing Dropbox access token...');

  const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: DROPBOX_REFRESH_TOKEN,
      client_id: DROPBOX_APP_KEY,
      client_secret: DROPBOX_APP_SECRET
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to refresh Dropbox token: ${error}`);
  }

  const data = await response.json();
  currentAccessToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in * 1000);

  console.log('✓ Dropbox access token refreshed\n');
  return currentAccessToken;
}

/**
 * Get valid Dropbox access token
 */
async function getDropboxToken() {
  if (Date.now() > tokenExpiry - 300000) {
    return await refreshDropboxToken();
  }
  return currentAccessToken;
}

/**
 * Get Dropbox API headers with namespace
 */
async function getDropboxHeaders() {
  const token = await getDropboxToken();

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  if (DROPBOX_NAMESPACE_ID) {
    headers['Dropbox-API-Path-Root'] = JSON.stringify({
      ".tag": "namespace_id",
      "namespace_id": DROPBOX_NAMESPACE_ID
    });
  }

  return headers;
}

// ============================================================================
// DROPBOX FILE OPERATIONS
// ============================================================================

/**
 * List all files in a Dropbox folder recursively
 */
async function listDropboxFiles(dropboxPath) {
  const files = [];

  async function listFolder(folderPath) {
    try {
      const headers = await getDropboxHeaders();

      const response = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          path: folderPath,
          recursive: false
        })
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`HTTP ${response.status}: ${error}`);
      }

      const data = await response.json();

      for (const entry of data.entries) {
        if (entry['.tag'] === 'folder') {
          // Recursively list subfolder
          await listFolder(entry.path_lower);
        } else if (entry['.tag'] === 'file') {
          // Skip hidden files and system files
          if (entry.name.startsWith('.') || entry.name.startsWith('~$')) {
            continue;
          }
          // Skip Excel files (claim templates consume too many tokens)
          if (entry.name.endsWith('.xlsx') || entry.name.endsWith('.xls')) {
            continue;
          }
          files.push({
            name: entry.name,
            path: entry.path_lower,
            size: entry.size
          });
        }
      }

      // Handle pagination
      if (data.has_more) {
        let cursor = data.cursor;
        while (cursor) {
          const continueResponse = await fetch('https://api.dropboxapi.com/2/files/list_folder/continue', {
            method: 'POST',
            headers,
            body: JSON.stringify({ cursor })
          });

          if (!continueResponse.ok) {
            break;
          }

          const continueData = await continueResponse.json();

          for (const entry of continueData.entries) {
            if (entry['.tag'] === 'folder') {
              await listFolder(entry.path_lower);
            } else if (entry['.tag'] === 'file') {
              if (entry.name.startsWith('.') || entry.name.startsWith('~$')) {
                continue;
              }
              files.push({
                name: entry.name,
                path: entry.path_lower,
                size: entry.size
              });
            }
          }

          cursor = continueData.has_more ? continueData.cursor : null;
        }
      }
    } catch (error) {
      console.error(`Error listing folder ${folderPath}:`, error.message);
    }
  }

  await listFolder(dropboxPath);
  return files;
}

/**
 * Download file from Dropbox
 */
async function downloadDropboxFile(filePath) {
  try {
    const token = await getDropboxToken();

    const headers = {
      'Authorization': `Bearer ${token}`,
      'Dropbox-API-Arg': JSON.stringify({ path: filePath })
    };

    if (DROPBOX_NAMESPACE_ID) {
      headers['Dropbox-API-Path-Root'] = JSON.stringify({
        ".tag": "namespace_id",
        "namespace_id": DROPBOX_NAMESPACE_ID
      });
    }

    const response = await fetch('https://content.dropboxapi.com/2/files/download', {
      method: 'POST',
      headers
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`HTTP ${response.status}: ${error}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer;
  } catch (error) {
    console.error(`Error downloading ${filePath}:`, error.message);
    return null;
  }
}

// ============================================================================
// FILE PARSING UTILITIES
// ============================================================================

/**
 * Read PDF file and extract text from buffer
 */
async function readPDF(buffer, fileName) {
  try {
    const { createRequire } = await import('module');
    const require = createRequire(import.meta.url);
    const PDFExtract = require('pdf.js-extract').PDFExtract;

    const pdfExtract = new PDFExtract();
    const options = {};
    const data = await pdfExtract.extractBuffer(buffer, options);

    // Combine text from all pages
    const text = data.pages
      .map(page => page.content.map(item => item.str).join(' '))
      .join('\n\n');

    return text;
  } catch (error) {
    console.error(`Error reading PDF ${fileName}:`, error.message);
    return null;
  }
}

/**
 * Read DOCX file and extract text from buffer
 */
async function readDOCX(buffer, fileName) {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  } catch (error) {
    console.error(`Error reading DOCX ${fileName}:`, error.message);
    return null;
  }
}

/**
 * Read Excel/CSV file and extract text from buffer
 */
function readSpreadsheet(buffer, fileName) {
  try {
    const workbook = xlsx.read(buffer, { type: 'buffer' });
    let allText = '';

    workbook.SheetNames.forEach(sheetName => {
      const sheet = workbook.Sheets[sheetName];
      const csv = xlsx.utils.sheet_to_csv(sheet);
      allText += `\n\n=== Sheet: ${sheetName} ===\n${csv}\n`;
    });

    return allText;
  } catch (error) {
    console.error(`Error reading spreadsheet ${fileName}:`, error.message);
    return null;
  }
}

/**
 * Read text file from buffer
 */
function readTextFile(buffer, fileName) {
  try {
    return buffer.toString('utf-8');
  } catch (error) {
    console.error(`Error reading text file ${fileName}:`, error.message);
    return null;
  }
}

/**
 * Parse file based on extension
 */
async function parseFile(buffer, fileName) {
  const ext = path.extname(fileName).toLowerCase();

  let content = null;

  switch (ext) {
    case '.pdf':
      content = await readPDF(buffer, fileName);
      break;
    case '.docx':
    case '.doc':
      content = await readDOCX(buffer, fileName);
      break;
    case '.xlsx':
    case '.xls':
    case '.csv':
      content = readSpreadsheet(buffer, fileName);
      break;
    case '.txt':
    case '.md':
      content = readTextFile(buffer, fileName);
      break;
    default:
      console.log(`⚠️  Skipping unsupported file type: ${fileName}`);
      return null;
  }

  if (content) {
    console.log(`✓ Read: ${fileName} (${content.length} chars)`);
  }

  return content ? { fileName, content } : null;
}

/**
 * Download and parse all files from Dropbox folder
 */
async function readDropboxFolder(dropboxPath, maxFiles = null) {
  console.log(`\n📂 Listing files from Dropbox: ${dropboxPath}\n`);

  const files = await listDropboxFiles(dropboxPath);
  console.log(`\n📂 Found ${files.length} files in Dropbox folder\n`);

  if (maxFiles) {
    console.log(`📌 Limiting to first ${maxFiles} files\n`);
  }

  const fileContents = [];
  let filesProcessed = 0;

  for (const file of files) {
    // Check if we've reached the max files limit
    if (maxFiles && filesProcessed >= maxFiles) {
      console.log(`\n⏹️  Reached maximum file limit (${maxFiles} files)\n`);
      break;
    }

    // Skip very large files (> 50MB)
    if (file.size > 50 * 1024 * 1024) {
      console.log(`⚠️  Skipping large file: ${file.name} (${Math.round(file.size / 1024 / 1024)}MB)`);
      continue;
    }

    const buffer = await downloadDropboxFile(file.path);
    if (buffer) {
      const parsed = await parseFile(buffer, file.name);
      if (parsed) {
        fileContents.push(parsed);
        filesProcessed++;
      }
    }
  }

  console.log(`\n✓ Successfully read ${fileContents.length} files\n`);

  return fileContents;
}

// ============================================================================
// EXAMPLE CARDS AND TEMPLATE LOADING
// ============================================================================

/**
 * Load template and example cards for Claude context
 */
function loadExamplesAndTemplate() {
  const baseDir = '/Users/Chris/Downloads/programs';

  // Load template
  const template = fs.readFileSync(path.join(baseDir, '_TEMPLATE.md'), 'utf-8');

  // Load 5 enriched example cards
  const enrichedCards = [
    'hiring/workbc-wage-subsidy.md',
    'hiring/digital-wil.md',
    'hiring/venture-for-canada.md',
    'hiring/unac-green-corps.md',
    'hiring/welcoming-newcomers.md',
  ].map(cardPath => {
    const fullPath = path.join(baseDir, cardPath);
    const content = fs.readFileSync(fullPath, 'utf-8');
    const programName = path.basename(cardPath, '.md');
    return { programName, content };
  });

  console.log('✓ Loaded template and 5 enriched example cards\n');

  return { template, enrichedCards };
}

// ============================================================================
// CLAUDE API - CARD GENERATION
// ============================================================================

/**
 * Generate program card using Claude
 */
async function generateCard(programName, fileContents, template, enrichedCards) {
  console.log('🤖 Calling Claude API to generate program card...\n');

  // Build context from files
  const filesContext = fileContents.map(({ fileName, content }) => {
    // Truncate very long files to prevent context overflow
    const truncated = content.length > 10000 ? content.substring(0, 10000) + '\n\n[... truncated ...]' : content;
    return `=== FILE: ${fileName} ===\n${truncated}\n`;
  }).join('\n\n');

  // Build examples context
  const examplesContext = enrichedCards.map(({ programName, content }) => {
    return `=== EXAMPLE CARD: ${programName} ===\n${content}\n`;
  }).join('\n\n');

  const systemPrompt = `You are a grant program documentation expert. Your job is to extract information from raw program documentation and structure it into a standardized program card format.

You will be given:
1. A template showing the required structure
2. Example cards showing what good output looks like
3. Raw documentation files for a specific program

Your task:
1. Read and understand all the documentation
2. Extract all relevant program information
3. **ANONYMIZE** any client-specific details:
   - Replace company names with [Company] or generic descriptions
   - Convert specific dollar amounts to ranges (e.g., "$45,000" → "$40,000-$50,000")
   - Remove contact names, phone numbers, email addresses
   - Generalize business-specific details
4. Structure the information according to the template
5. Write in clear, actionable language suitable for both internal staff and SME clients
6. Include field-by-field form guidance in the "Form & Document Guidance" section when form details are available

Focus on:
- Eligibility criteria (who qualifies, who doesn't)
- Application process (step-by-step instructions)
- Document requirements (what's needed and when)
- Claims process (how to get reimbursed)
- Common pitfalls and best practices
- Program-specific quirks and rules

Write as if you're creating an expert reference guide that someone could use to navigate the entire program lifecycle without external help.`;

  const userPrompt = `Generate a program card for: **${programName}**

TEMPLATE TO FOLLOW:
${template}

RAW DOCUMENTATION FILES:
${filesContext}

Generate a complete, well-structured program card following the template format. Include all sections that are relevant based on the documentation provided. If certain sections don't have sufficient information, note that clearly rather than inventing details.

Remember to ANONYMIZE all client-specific information.`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 16000,
      temperature: 1.0,
      thinking: {
        type: 'enabled',
        budget_tokens: 10000
      },
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: userPrompt
      }]
    });

    // Extract text content
    const textBlocks = response.content.filter(block => block.type === 'text');
    const cardContent = textBlocks.map(block => block.text).join('\n\n');

    console.log(`✓ Generated card (${cardContent.length} chars)\n`);

    return cardContent;

  } catch (error) {
    console.error('❌ Error calling Claude API:', error);
    throw error;
  }
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  let programName = null;
  let dropboxPath = null;
  let outputPath = null;
  let maxFiles = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--program' && args[i + 1]) {
      programName = args[i + 1];
      i++;
    } else if (args[i] === '--dropbox-path' && args[i + 1]) {
      dropboxPath = args[i + 1];
      i++;
    } else if (args[i] === '--output' && args[i + 1]) {
      outputPath = args[i + 1];
      i++;
    } else if (args[i] === '--max-files' && args[i + 1]) {
      maxFiles = parseInt(args[i + 1], 10);
      i++;
    }
  }

  // Validate inputs
  if (!programName || !dropboxPath) {
    console.error('❌ Missing required arguments\n');
    console.log('Usage:');
    console.log('  node scripts/generate-program-card.js --program "Program Name" --dropbox-path "/Granted Team Folder/SALES/Grants/ProgramFolder"\n');
    console.log('Options:');
    console.log('  --program        Program name (e.g., "WorkBC Wage Subsidy")');
    console.log('  --dropbox-path   Dropbox path to folder containing program documentation');
    console.log('  --output         Optional output path (defaults to programs/generated/[program-id].md)\n');
    process.exit(1);
  }

  // Generate output filename
  if (!outputPath) {
    const programId = programName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const outputDir = '/Users/Chris/grant-card-assistant/programs/generated';

    // Create generated directory if it doesn't exist
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    outputPath = path.join(outputDir, `${programId}.md`);
  }

  console.log('='.repeat(80));
  console.log('PROGRAM CARD GENERATOR - DROPBOX EDITION');
  console.log('='.repeat(80));
  console.log('');
  console.log(`Program: ${programName}`);
  console.log(`Dropbox Path: ${dropboxPath}`);
  console.log(`Output: ${outputPath}`);
  console.log('');
  console.log('='.repeat(80));
  console.log('');

  // Step 1: List and download files from Dropbox
  const fileContents = await readDropboxFolder(dropboxPath, maxFiles);

  if (fileContents.length === 0) {
    console.error('❌ No readable files found in Dropbox folder');
    process.exit(1);
  }

  // Step 2: Load template and examples
  const { template, enrichedCards } = loadExamplesAndTemplate();

  // Step 3: Generate card with Claude
  const cardContent = await generateCard(programName, fileContents, template, enrichedCards);

  // Step 4: Write output
  fs.writeFileSync(outputPath, cardContent, 'utf-8');

  console.log('='.repeat(80));
  console.log('✅ CARD GENERATION COMPLETE');
  console.log('='.repeat(80));
  console.log('');
  console.log(`Output saved to: ${outputPath}`);
  console.log('');
  console.log('NEXT STEPS:');
  console.log('1. Review the generated card');
  console.log('2. Verify anonymization is complete');
  console.log('3. Fill in any gaps or missing sections');
  console.log('4. Add any additional program-specific quirks or best practices');
  console.log('5. Move to appropriate folder (programs/hiring/ or programs/training/)');
  console.log('');
}

// Run
main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
