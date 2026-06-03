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
 *
 * NOTE: Sub-skill names must be unique within each skill domain (not globally)
 */
const SKILL_PATHS = {
  sales: {
    lead_farming: '.claude/skills/sales-consultant/LEAD_FARMING.md',
    linkedin_enrichment: '.claude/skills/sales-consultant/LINKEDIN_ENRICHMENT.md',
    data_quality: '.claude/skills/sales-consultant/DATA_QUALITY.md',
    icp_analysis: '.claude/skills/sales-consultant/ICP_ANALYSIS.md'
  },
  grants: {
    overview: '.claude/skills/grants-consultant/SKILL.md',
    eligibility: '.claude/skills/grants-consultant/ELIGIBILITY.md',
    matching: '.claude/skills/grants-consultant/MATCHING.md',
    validation: '.claude/skills/grants-consultant/VALIDATION.md'
  },
  research: {
    company_intelligence: '.claude/skills/research-consultant/COMPANY_INTELLIGENCE.md'
  },
  'canexport-writer': {
    overview: '.claude/skills/canexport-writer/SKILL.md',
    PROGRAM_DETAILS: '.claude/skills/canexport-writer/PROGRAM_DETAILS.md',
    APPLICATION_STRUCTURE: '.claude/skills/canexport-writer/APPLICATION_STRUCTURE.md',
    KNOWLEDGE_BASE_INDEX: '.claude/skills/canexport-writer/KNOWLEDGE_BASE_INDEX.md',
    STAGE_1_READINESS: '.claude/skills/canexport-writer/STAGE_1_READINESS.md',
    STAGE_1_BUDGET_GUIDE: '.claude/skills/canexport-writer/STAGE_1_BUDGET_GUIDE.md',
    STAGE_1_INTERVIEW_QUESTIONS: '.claude/skills/canexport-writer/STAGE_1_INTERVIEW_QUESTIONS.md',
    STAGE_2_DRAFTING: '.claude/skills/canexport-writer/STAGE_2_DRAFTING.md',
    STAGE_3_REVIEW: '.claude/skills/canexport-writer/STAGE_3_REVIEW.md'
  },
  'bcafe-writer': {
    FINAL_REPORT: '.claude/skills/bcafe-writer/FINAL_REPORT.md'
  },
  hubspot: {
    DEAL_CREATION: '.claude/skills/hubspot/DEAL_CREATION.md'
  },
  'granted-marketing': {
    overview: '.claude/skills/granted-marketing/SKILL.md',
    FOUNDATIONS: '.claude/skills/granted-marketing/FOUNDATIONS.md',
    COMPANY_CONTEXT: '.claude/skills/granted-marketing/COMPANY_CONTEXT.md',
    GRANT_BLASTS: '.claude/skills/granted-marketing/GRANT_BLASTS.md',
    BLOGS: '.claude/skills/granted-marketing/BLOGS.md',
    EMAILS: '.claude/skills/granted-marketing/EMAILS.md',
    LINKEDIN: '.claude/skills/granted-marketing/LINKEDIN.md',
    WEBINARS: '.claude/skills/granted-marketing/WEBINARS.md',
    SUCCESS_STORIES: '.claude/skills/granted-marketing/SUCCESS_STORIES.md',
    PARTNERSHIPS: '.claude/skills/granted-marketing/PARTNERSHIPS.md',
    DATA_SOURCES: '.claude/skills/granted-marketing/DATA_SOURCES.md',
    EXPLORATION: '.claude/skills/granted-marketing/EXPLORATION.md'
  },
  'staff-meeting-recap': {
    overview: '.claude/skills/staff-meeting-recap/SKILL.md'
  },
  'grant-card-writing': {
    OVERVIEW: '.claude/skills/grant-card-writing/OVERVIEW.md',
    RD: '.claude/skills/grant-card-writing/RD.md',
    BUSINESS_ASSESSMENT: '.claude/skills/grant-card-writing/BUSINESS_ASSESSMENT.md',
    MARKET_EXPANSION: '.claude/skills/grant-card-writing/MARKET_EXPANSION.md',
    HIRING_TRAINING: '.claude/skills/grant-card-writing/HIRING_TRAINING.md',
    SYSTEMS_PROCESSES: '.claude/skills/grant-card-writing/SYSTEMS_PROCESSES.md',
    CAPITAL_COST: '.claude/skills/grant-card-writing/CAPITAL_COST.md',
    LOANS: '.claude/skills/grant-card-writing/LOANS.md',
    INVESTMENT: '.claude/skills/grant-card-writing/INVESTMENT.md',
    PRIZES_CONTESTS: '.claude/skills/grant-card-writing/PRIZES_CONTESTS.md'
  },
  'grant-card-tagging': {
    OVERVIEW: '.claude/skills/grant-card-tagging/OVERVIEW.md'
  },
  'granted-insights': {
    OVERVIEW: '.claude/skills/granted-insights/OVERVIEW.md',
    HIRING: '.claude/skills/granted-insights/HIRING.md',
    TRAINING: '.claude/skills/granted-insights/TRAINING.md',
    MARKET_EXPANSION: '.claude/skills/granted-insights/MARKET_EXPANSION.md',
    RD_CAPEX: '.claude/skills/granted-insights/RD_CAPEX.md',
    REPAYABLE_FUNDING: '.claude/skills/granted-insights/REPAYABLE_FUNDING.md',
    EXEMPLAR: '.claude/skills/granted-insights/EXEMPLAR.md'
  }
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
