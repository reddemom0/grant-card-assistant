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
 * Load agent prompt from .claude/agents/{agentType}.md
 * @param {string} agentType - Type of agent (e.g., 'grant-card-generator', 'etg-writer')
 * @returns {string} Agent system prompt
 * @throws {Error} If agent definition file not found
 */
export function loadAgentPrompt(agentType) {
  const agentPath = path.join(getAgentsDirectory(), `${agentType}.md`);

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
    console.log(`✓ Loaded agent prompt: ${agentType} (with frontmatter)`);
    return body;
  }

  // No frontmatter - return entire content
  console.log(`✓ Loaded agent prompt: ${agentType} (${content.length} chars)`);
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

export function loadAgentPromptCached(agentType) {
  if (process.env.NODE_ENV === 'production' && promptCache.has(agentType)) {
    return promptCache.get(agentType);
  }

  const prompt = loadAgentPrompt(agentType);

  if (process.env.NODE_ENV === 'production') {
    promptCache.set(agentType, prompt);
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
