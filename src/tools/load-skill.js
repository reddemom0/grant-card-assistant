/**
 * Load Skill Tool
 *
 * Dynamically loads specialized skill documentation from filesystem
 * for context-aware agent expertise without bloating the system prompt.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Skill file mappings
 * Each sub_skill maps to one specific markdown file
 */
const SKILL_PATHS = {
  sales: {
    lead_farming: '.claude/skills/sales-consultant/LEAD_FARMING.md',
    linkedin_enrichment: '.claude/skills/sales-consultant/LINKEDIN_ENRICHMENT.md',
    data_quality: '.claude/skills/sales-consultant/DATA_QUALITY.md',
    icp_analysis: '.claude/skills/sales-consultant/ICP_ANALYSIS.md'
  },
  research: {
    company_intelligence: '.claude/skills/research-consultant/COMPANY_INTELLIGENCE.md'
  }
  // Add more skills as they're created: grants, writing, etc.
};

/**
 * Load a specific skill sub-module
 *
 * @param {Object} params
 * @param {string} params.skill_name - The skill domain (e.g., 'sales')
 * @param {string} params.sub_skill - The specific sub-skill to load (e.g., 'lead_farming')
 * @returns {Object} - Skill content and metadata
 */
export async function loadSkill({ skill_name, sub_skill }) {
  try {
    // Validate skill exists
    if (!SKILL_PATHS[skill_name]) {
      throw new Error(`Unknown skill: ${skill_name}. Available skills: ${Object.keys(SKILL_PATHS).join(', ')}`);
    }

    // Validate sub_skill exists
    const skillFiles = SKILL_PATHS[skill_name];
    if (!skillFiles[sub_skill]) {
      throw new Error(`Unknown sub-skill '${sub_skill}' for skill '${skill_name}'. Available sub-skills: ${Object.keys(skillFiles).join(', ')}`);
    }

    // Get file path (relative to project root)
    const relativeFilePath = skillFiles[sub_skill];

    // Resolve absolute path (go up from src/tools/ to project root)
    const projectRoot = path.resolve(__dirname, '../../');
    const absoluteFilePath = path.join(projectRoot, relativeFilePath);

    // Read skill file
    console.log(`📚 Loading skill: ${skill_name}/${sub_skill} from ${relativeFilePath}`);
    const content = await fs.readFile(absoluteFilePath, 'utf-8');

    // Calculate token estimate (rough: 4 characters per token)
    const tokenEstimate = Math.ceil(content.length / 4);
    const lineCount = content.split('\n').length;

    console.log(`✅ Skill loaded: ${lineCount} lines, ~${tokenEstimate} tokens`);

    return {
      success: true,
      skill_name,
      sub_skill,
      file_path: relativeFilePath,
      content,
      metadata: {
        lines: lineCount,
        characters: content.length,
        token_estimate: tokenEstimate
      }
    };

  } catch (error) {
    console.error(`❌ Error loading skill ${skill_name}/${sub_skill}:`, error.message);

    return {
      success: false,
      error: error.message,
      skill_name,
      sub_skill
    };
  }
}
