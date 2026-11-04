/**
 * Agent Loader
 *
 * Loads agent prompt definitions from .claude/agents/*.md files
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Get path to agent definitions directory
 * @returns {string} Absolute path to .claude/agents directory
 */
function getAgentsDirectory() {
  // Go up from src/agents/ to project root, then into .claude/agents
  return path.join(__dirname, '../../.claude/agents');
}

/**
 * Keep the prompt text for one lead-gen matcher and drop the other's.
 *
 * Variant B marks matcher-specific text with whole-line HTML comments:
 *   <!-- legacy-matcher --> … <!-- /legacy-matcher -->  (search_getgranted path)
 *   <!-- gg3-matcher --> … <!-- /gg3-matcher -->        (precomputed estimate)
 * The kept blocks lose only their marker lines, so a legacy session's prompt
 * is byte-for-byte the unmarked text. The dropped blocks go whole; in gg3 mode
 * the blank lines they leave are collapsed.
 *
 * @param {string} text - one prompt file's contents
 * @param {'legacy'|'gg3'} [matcher] - anything but 'gg3' means legacy
 * @returns {string}
 */
export function selectMatcherBlocks(text, matcher = 'legacy') {
  const keep = matcher === 'gg3' ? 'gg3' : 'legacy';
  const drop = keep === 'gg3' ? 'legacy' : 'gg3';
  const dropBlock = new RegExp(`^<!-- ${drop}-matcher -->\\n[\\s\\S]*?^<!-- \\/${drop}-matcher -->\\n`, 'gm');
  const keepMarker = new RegExp(`^<!-- \\/?${keep}-matcher -->\\n`, 'gm');
  const out = text.replace(dropBlock, '').replace(keepMarker, '');
  return keep === 'gg3' ? out.replace(/\n{3,}/g, '\n\n') : out;
}

/**
 * Load agent prompt from .claude/agents/{agentType}.md
 * @param {string} agentType - Type of agent (e.g., 'grant-card-generator', 'etg-writer')
 * @param {Object} [opts]
 * @param {'legacy'|'gg3'} [opts.matcher] - lead-gen Variant B only: the
 *   session's matcher stamp (getLeadGenMatcher). Defaults to legacy.
 * @returns {string} Agent system prompt
 * @throws {Error} If agent definition file not found
 */
export function loadAgentPrompt(agentType, { matcher = 'legacy' } = {}) {
  // A/B Testing: Support variant switching for lead-gen agent
  let agentFileName = `${agentType}.md`;
  let variant = null;

  if (agentType === 'lead-gen') {
    const variantEnv = process.env.LEAD_GEN_VARIANT || 'A';
    variant = variantEnv.toUpperCase();

    if (variant === 'B') {
      // Variant B: Load modular skill documents and concatenate
      const skillsDir = path.join(__dirname, '../../.claude/skills/lead-gen-variant-b');

      const skillFiles = [
        'base-system-prompt.md',
        'client-communication.md',
        'system-operations.md'
      ];

      const skillContents = skillFiles.map(fileName => {
        const skillPath = path.join(skillsDir, fileName);

        if (!fs.existsSync(skillPath)) {
          throw new Error(
            `Lead-gen variant B skill file not found: ${fileName}\n` +
            `Expected path: ${skillPath}`
          );
        }

        return selectMatcherBlocks(fs.readFileSync(skillPath, 'utf-8'), matcher).trim();
      });

      const concatenated = skillContents.join('\n\n---\n\n');

      console.log(`✓ Loaded agent prompt: ${agentType} VARIANT ${variant} matcher=${matcher === 'gg3' ? 'gg3' : 'legacy'} (${skillFiles.length} skill files, ${concatenated.length} chars)`);

      return concatenated;
    } else {
      // Variant A (default) - use standard lead-gen.md
      agentFileName = 'lead-gen.md';
    }
  }

  const agentPath = path.join(getAgentsDirectory(), agentFileName);

  if (!fs.existsSync(agentPath)) {
    throw new Error(
      `Agent definition not found: ${agentType}\n` +
      `Expected file: ${agentPath}\n` +
      `Available agents: ${getAvailableAgents().join(', ')}`
    );
  }

  const content = fs.readFileSync(agentPath, 'utf-8');

  // Parse YAML frontmatter if it exists
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

  if (frontmatterMatch) {
    // Has frontmatter - extract metadata and return body
    const frontmatter = frontmatterMatch[1];
    const body = frontmatterMatch[2].trim();

    // You could parse the frontmatter YAML here if needed
    // For now, just return the body
    if (variant) {
      console.log(`✓ Loaded agent prompt: ${agentType} VARIANT ${variant} (with frontmatter)`);
    } else {
      console.log(`✓ Loaded agent prompt: ${agentType} (with frontmatter)`);
    }
    return body;
  }

  // No frontmatter - return entire content
  if (variant) {
    console.log(`✓ Loaded agent prompt: ${agentType} VARIANT ${variant} (${content.length} chars)`);
  } else {
    console.log(`✓ Loaded agent prompt: ${agentType} (${content.length} chars)`);
  }
  return content.trim();
}

/**
 * Get list of available agents
 * @returns {Array<string>} Array of agent type names
 */
export function getAvailableAgents() {
  const agentsDir = getAgentsDirectory();

  if (!fs.existsSync(agentsDir)) {
    console.warn(`⚠️  Agents directory not found: ${agentsDir}`);
    return [];
  }

  return fs.readdirSync(agentsDir)
    .filter(file => file.endsWith('.md'))
    .map(file => file.replace('.md', ''))
    .sort();
}

/**
 * Validate that an agent type exists
 * @param {string} agentType - Agent type to validate
 * @returns {boolean} True if agent exists
 */
export function isValidAgentType(agentType) {
  const availableAgents = getAvailableAgents();
  return availableAgents.includes(agentType);
}

/**
 * Get metadata for all available agents
 * @returns {Array<Object>} Array of {type, name, description} objects
 */
export function getAgentMetadata() {
  const agents = getAvailableAgents();

  return agents.map(agentType => {
    try {
      const prompt = loadAgentPrompt(agentType);

      // Try to extract title from first heading
      const titleMatch = prompt.match(/^#\s+(.+)$/m);
      const title = titleMatch ? titleMatch[1] : agentType;

      // Try to extract first paragraph as description
      const descMatch = prompt.match(/^(?!#)(.+)$/m);
      const description = descMatch ? descMatch[1].trim() : '';

      return {
        type: agentType,
        name: title,
        description: description.substring(0, 200) // Limit length
      };
    } catch (error) {
      return {
        type: agentType,
        name: agentType,
        description: 'No description available',
        error: error.message
      };
    }
  });
}

/**
 * Reload agent prompt (useful for development)
 * In production, prompts are cached after first load
 */
const promptCache = new Map();

export function loadAgentPromptCached(agentType, { matcher } = {}) {
  // lead-gen has one prompt per matcher; every other agent has one prompt.
  const cacheKey = agentType === 'lead-gen' ? `${agentType}:${matcher === 'gg3' ? 'gg3' : 'legacy'}` : agentType;
  if (process.env.NODE_ENV === 'production' && promptCache.has(cacheKey)) {
    return promptCache.get(cacheKey);
  }

  const prompt = loadAgentPrompt(agentType, agentType === 'lead-gen' ? { matcher } : {});

  if (process.env.NODE_ENV === 'production') {
    promptCache.set(cacheKey, prompt);
  }

  return prompt;
}

/**
 * Clear prompt cache (for development/testing)
 */
export function clearPromptCache() {
  promptCache.clear();
  console.log('✓ Agent prompt cache cleared');
}
