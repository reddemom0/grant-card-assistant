/**
 * Fixture Auto-Generator for Testing Framework
 *
 * Automatically generates test fixtures from knowledge base documents.
 * Handles PDF/DOCX extraction, anonymization, and categorization.
 */

const fs = require('fs').promises;
const path = require('path');
const { google } = require('googleapis');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

// Agent folder mapping (from server.js)
const AGENT_FOLDER_MAP = {
  'grant-cards': 'grant-cards',
  'etg-writer': 'etg',
  'bcafe-writer': 'bcafe',
  'canexport-claims': 'canexport-claims'
};

/**
 * Initialize Google Drive client
 *
 * @returns {Object} Google Drive API client
 */
function initializeDriveClient() {
  const serviceAccountKey = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);

  const auth = new google.auth.GoogleAuth({
    credentials: serviceAccountKey,
    scopes: ['https://www.googleapis.com/auth/drive.readonly']
  });

  return google.drive({ version: 'v3', auth });
}

/**
 * List files in a Google Drive folder
 *
 * @param {Object} drive - Google Drive client
 * @param {string} folderId - Folder ID
 * @returns {Promise<Array>} List of files
 */
async function listFilesInFolder(drive, folderId) {
  try {
    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'files(id, name, mimeType, size)',
      pageSize: 100
    });

    return response.data.files || [];
  } catch (error) {
    console.error(`Failed to list files in folder ${folderId}:`, error.message);
    return [];
  }
}

/**
 * Download file from Google Drive
 *
 * @param {Object} drive - Google Drive client
 * @param {string} fileId - File ID
 * @returns {Promise<Buffer>} File content as buffer
 */
async function downloadFile(drive, fileId) {
  const response = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' }
  );

  return Buffer.from(response.data);
}

/**
 * Extract text from PDF buffer
 *
 * @param {Buffer} buffer - PDF file buffer
 * @returns {Promise<string>} Extracted text
 */
async function extractPDFText(buffer) {
  try {
    const data = await pdfParse(buffer);
    return data.text;
  } catch (error) {
    console.error('PDF extraction failed:', error.message);
    return null;
  }
}

/**
 * Extract text from DOCX buffer
 *
 * @param {Buffer} buffer - DOCX file buffer
 * @returns {Promise<string>} Extracted text
 */
async function extractDOCXText(buffer) {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  } catch (error) {
    console.error('DOCX extraction failed:', error.message);
    return null;
  }
}

/**
 * Anonymize sensitive data in text
 *
 * @param {string} text - Original text
 * @returns {string} Anonymized text
 */
function anonymizeText(text) {
  let anonymized = text;

  // Anonymize email addresses
  anonymized = anonymized.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[EMAIL]');

  // Anonymize phone numbers (various formats)
  anonymized = anonymized.replace(/\b(\+?1[-.]?)?\(?\d{3}\)?[-.]?\d{3}[-.]?\d{4}\b/g, '[PHONE]');

  // Anonymize postal codes (Canadian format)
  anonymized = anonymized.replace(/\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b/g, '[POSTAL_CODE]');

  // Anonymize SIN/EIN numbers
  anonymized = anonymized.replace(/\b\d{3}[-\s]?\d{3}[-\s]?\d{3}\b/g, '[ID_NUMBER]');

  // Anonymize common personal names (basic pattern - may need refinement)
  // This is a conservative approach to avoid over-anonymization

  return anonymized;
}

/**
 * Categorize document based on filename and content
 *
 * @param {string} filename - Document filename
 * @param {string} content - Document content
 * @param {string} agentType - Agent type
 * @returns {Object} Category metadata
 */
function categorizeDocument(filename, content, agentType) {
  const lower = filename.toLowerCase();
  const contentLower = content.toLowerCase();

  const categories = {
    'canexport-claims': {
      'approved-expense': ['approved', 'eligible', 'accepted'],
      'rejected-expense': ['rejected', 'ineligible', 'denied'],
      'category-a': ['category a', 'airfare', 'flight'],
      'category-b': ['category b', 'marketing', 'promotional'],
      'category-c': ['category c', 'translation', 'interpretation'],
      'category-d': ['category d', 'shipping', 'courier'],
      'historical-pattern': ['historical', 'pattern', 'precedent']
    },
    'etg-writer': {
      'eligible-training': ['eligible', 'approved', 'certification', 'certificate'],
      'ineligible-training': ['ineligible', 'rejected', 'seminar', 'conference', 'degree'],
      'business-case': ['business case', 'example', 'template'],
      'eligibility-guide': ['eligibility', 'criteria', 'requirements']
    },
    'grant-cards': {
      'hiring-grant': ['hiring', 'wage subsidy', 'employment'],
      'training-grant': ['training', 'skills development', 'education'],
      'rd-grant': ['research', 'development', 'innovation', 'r&d'],
      'market-grant': ['market expansion', 'export', 'capital equipment'],
      'loan-program': ['loan', 'financing', 'interest'],
      'investment-fund': ['investment', 'equity', 'venture capital']
    },
    'bcafe-writer': {
      'producer-application': ['producer', '50% match'],
      'association-application': ['association', '30% match'],
      'eligibility-checklist': ['eligibility', 'checklist', 'requirements'],
      'merit-criteria': ['merit', 'evaluation', 'scoring']
    }
  };

  const agentCategories = categories[agentType] || {};
  let detectedCategory = 'general';

  for (const [category, keywords] of Object.entries(agentCategories)) {
    for (const keyword of keywords) {
      if (lower.includes(keyword) || contentLower.includes(keyword)) {
        detectedCategory = category;
        break;
      }
    }
    if (detectedCategory !== 'general') break;
  }

  return {
    category: detectedCategory,
    filename,
    agentType
  };
}

/**
 * Generate fixture from knowledge base document
 *
 * @param {Object} drive - Google Drive client
 * @param {Object} file - File metadata from Drive
 * @param {string} agentType - Agent type
 * @param {Object} options - Generation options
 * @returns {Promise<Object>} Fixture object
 */
async function generateFixture(drive, file, agentType, options = {}) {
  const {
    anonymize = true,
    maxLength = 10000 // Max characters for fixture
  } = options;

  console.log(`Generating fixture: ${file.name} (${agentType})`);

  // Download file
  const buffer = await downloadFile(drive, file.id);

  // Extract text based on file type
  let text = null;
  if (file.mimeType === 'application/pdf') {
    text = await extractPDFText(buffer);
  } else if (file.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    text = await extractDOCXText(buffer);
  } else if (file.mimeType === 'text/plain') {
    text = buffer.toString('utf8');
  } else {
    console.warn(`Unsupported file type: ${file.mimeType} for ${file.name}`);
    return null;
  }

  if (!text) {
    console.warn(`Failed to extract text from ${file.name}`);
    return null;
  }

  // Anonymize if requested
  if (anonymize) {
    text = anonymizeText(text);
  }

  // Truncate if too long
  if (text.length > maxLength) {
    text = text.substring(0, maxLength) + '\n\n[Content truncated for testing]';
  }

  // Categorize document
  const category = categorizeDocument(file.name, text, agentType);

  return {
    filename: file.name,
    agentType,
    category: category.category,
    content: text,
    size: text.length,
    originalSize: parseInt(file.size) || 0,
    mimeType: file.mimeType,
    generatedAt: new Date().toISOString()
  };
}

/**
 * Generate all fixtures for an agent
 *
 * @param {string} agentType - Agent type
 * @param {Object} options - Generation options
 * @returns {Promise<Array>} Array of fixtures
 */
async function generateFixturesForAgent(agentType, options = {}) {
  const {
    limit = null, // Max files to process (null = all)
    outputDir = path.join(__dirname, '..', 'fixtures')
  } = options;

  console.log(`\n📁 Generating fixtures for: ${agentType}`);

  // Get folder ID for agent
  const folderName = AGENT_FOLDER_MAP[agentType];
  if (!folderName) {
    throw new Error(`Unknown agent type: ${agentType}`);
  }

  // Initialize Drive client
  const drive = initializeDriveClient();

  // Get root folder ID from environment
  const rootFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

  // List files in root to find agent folder
  const rootFiles = await listFilesInFolder(drive, rootFolderId);
  const agentFolder = rootFiles.find(f =>
    f.name.toLowerCase() === folderName.toLowerCase() &&
    f.mimeType === 'application/vnd.google-apps.folder'
  );

  if (!agentFolder) {
    throw new Error(`Agent folder not found: ${folderName}`);
  }

  console.log(`Found agent folder: ${agentFolder.name} (ID: ${agentFolder.id})`);

  // List files in agent folder
  const files = await listFilesInFolder(drive, agentFolder.id);
  console.log(`Found ${files.length} files in folder`);

  // Filter to supported file types
  const supportedTypes = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ];

  const supportedFiles = files.filter(f => supportedTypes.includes(f.mimeType));
  console.log(`${supportedFiles.length} files are supported document types`);

  // Apply limit if specified
  const filesToProcess = limit ? supportedFiles.slice(0, limit) : supportedFiles;

  // Generate fixtures
  const fixtures = [];
  for (const file of filesToProcess) {
    try {
      const fixture = await generateFixture(drive, file, agentType, options);
      if (fixture) {
        fixtures.push(fixture);
      }
    } catch (error) {
      console.error(`Failed to generate fixture for ${file.name}:`, error.message);
    }
  }

  console.log(`✅ Generated ${fixtures.length} fixtures for ${agentType}`);

  // Save fixtures to disk
  await saveFixtures(fixtures, agentType, outputDir);

  return fixtures;
}

/**
 * Save fixtures to disk
 *
 * @param {Array} fixtures - Array of fixture objects
 * @param {string} agentType - Agent type
 * @param {string} outputDir - Output directory
 */
async function saveFixtures(fixtures, agentType, outputDir) {
  // Create agent-specific directory
  const agentDir = path.join(outputDir, agentType);
  await fs.mkdir(agentDir, { recursive: true });

  // Group by category
  const byCategory = {};
  for (const fixture of fixtures) {
    const category = fixture.category;
    if (!byCategory[category]) {
      byCategory[category] = [];
    }
    byCategory[category].push(fixture);
  }

  // Save each category
  for (const [category, categoryFixtures] of Object.entries(byCategory)) {
    const filename = `${category}.json`;
    const filepath = path.join(agentDir, filename);

    await fs.writeFile(
      filepath,
      JSON.stringify(categoryFixtures, null, 2),
      'utf8'
    );

    console.log(`   Saved ${categoryFixtures.length} fixtures to ${filename}`);
  }

  // Save index file
  const indexPath = path.join(agentDir, 'index.json');
  const index = {
    agentType,
    totalFixtures: fixtures.length,
    categories: Object.keys(byCategory),
    generatedAt: new Date().toISOString()
  };

  await fs.writeFile(indexPath, JSON.stringify(index, null, 2), 'utf8');
  console.log(`   Saved index to index.json`);
}

/**
 * Generate fixtures for all operational agents
 *
 * @param {Object} options - Generation options
 * @returns {Promise<Object>} Summary of generated fixtures
 */
async function generateAllFixtures(options = {}) {
  const agents = [
    'canexport-claims',
    'etg-writer',
    'grant-cards',
    'bcafe-writer'
  ];

  const summary = {
    agents: {},
    total: 0,
    errors: []
  };

  for (const agent of agents) {
    try {
      const fixtures = await generateFixturesForAgent(agent, options);
      summary.agents[agent] = {
        count: fixtures.length,
        categories: [...new Set(fixtures.map(f => f.category))]
      };
      summary.total += fixtures.length;
    } catch (error) {
      console.error(`Failed to generate fixtures for ${agent}:`, error.message);
      summary.errors.push({
        agent,
        error: error.message
      });
    }
  }

  console.log('\n📊 Fixture Generation Summary:');
  console.log(`   Total fixtures: ${summary.total}`);
  console.log(`   Agents processed: ${Object.keys(summary.agents).length}`);
  console.log(`   Errors: ${summary.errors.length}`);

  return summary;
}

/**
 * Load fixtures for an agent
 *
 * @param {string} agentType - Agent type
 * @param {string} category - Optional category filter
 * @returns {Promise<Array>} Array of fixtures
 */
async function loadFixtures(agentType, category = null) {
  const fixturesDir = path.join(__dirname, '..', 'fixtures', agentType);

  if (category) {
    // Load specific category
    const filepath = path.join(fixturesDir, `${category}.json`);
    const content = await fs.readFile(filepath, 'utf8');
    return JSON.parse(content);
  } else {
    // Load all categories
    const indexPath = path.join(fixturesDir, 'index.json');
    const indexContent = await fs.readFile(indexPath, 'utf8');
    const index = JSON.parse(indexContent);

    const allFixtures = [];
    for (const cat of index.categories) {
      const categoryFixtures = await loadFixtures(agentType, cat);
      allFixtures.push(...categoryFixtures);
    }

    return allFixtures;
  }
}

module.exports = {
  // Core generation functions
  generateFixturesForAgent,
  generateAllFixtures,

  // Loading fixtures
  loadFixtures,

  // Utilities
  anonymizeText,
  categorizeDocument,

  // Internal functions (exported for testing)
  initializeDriveClient,
  extractPDFText,
  extractDOCXText
};
