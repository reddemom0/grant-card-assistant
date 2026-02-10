import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Load all available program cards from /programs directory
 * @returns {Object} Map of programId -> {type, name, content}
 */
export function loadAllProgramCards() {
  const programsDir = join(__dirname, '../../programs');
  const programCards = {};

  try {
    // Load hiring programs
    const hiringDir = join(programsDir, 'hiring');
    const hiringFiles = readdirSync(hiringDir).filter(f => f.endsWith('.md') && !f.startsWith('_'));

    for (const file of hiringFiles) {
      const programId = file.replace('.md', '');
      const content = readFileSync(join(hiringDir, file), 'utf8');
      programCards[programId] = {
        type: 'hiring',
        name: extractProgramName(content),
        content,
        filePath: `programs/hiring/${file}`
      };
    }

    // Load training programs
    const trainingDir = join(programsDir, 'training');
    const trainingFiles = readdirSync(trainingDir).filter(f => f.endsWith('.md') && !f.startsWith('_'));

    for (const file of trainingFiles) {
      const programId = file.replace('.md', '');
      const content = readFileSync(join(trainingDir, file), 'utf8');
      programCards[programId] = {
        type: 'training',
        name: extractProgramName(content),
        content,
        filePath: `programs/training/${file}`
      };
    }

    console.log(`✅ Loaded ${Object.keys(programCards).length} program cards`);
    return programCards;

  } catch (error) {
    console.warn('⚠️ Error loading program cards:', error.message);
    return {};
  }
}

/**
 * Load a specific program card by ID
 * @param {string} programId - Program identifier (filename without .md)
 * @returns {Object|null} Program card data or null if not found
 */
export function loadProgramCard(programId) {
  const allCards = loadAllProgramCards();
  return allCards[programId] || null;
}

/**
 * Extract program name from markdown content (first heading)
 * @param {string} content - Markdown content
 * @returns {string} Program name
 */
function extractProgramName(content) {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].replace(' Program Card', '') : 'Unknown Program';
}

/**
 * List all available programs grouped by type
 * @returns {Object} {hiring: [{id, name}], training: [{id, name}]}
 */
export function listAvailablePrograms() {
  const allCards = loadAllProgramCards();
  const programs = {
    hiring: [],
    training: []
  };

  for (const [id, card] of Object.entries(allCards)) {
    programs[card.type].push({
      id,
      name: card.name
    });
  }

  return programs;
}

export default {
  loadAllProgramCards,
  loadProgramCard,
  listAvailablePrograms
};
