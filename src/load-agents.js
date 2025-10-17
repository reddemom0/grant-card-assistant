import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Load agent definitions from .claude/agents/*.md files
 * Converts markdown files with YAML frontmatter to Agent SDK format
 */
export function loadAgentDefinitions() {
  const agentDir = join(__dirname, '..', '.claude', 'agents');
  
  const agents = {
    'grant-card-generator': parseAgentFile(join(agentDir, 'grant-card-generator.md')),
    'etg-writer': parseAgentFile(join(agentDir, 'etg-writer.md')),
    'bcafe-writer': parseAgentFile(join(agentDir, 'bcafe-writer.md')),
    'canexport-claims': parseAgentFile(join(agentDir, 'canexport-claims.md')),
    'orchestrator': parseAgentFile(join(agentDir, 'orchestrator.md')),
  };

  return agents;
}

/**
 * Parse agent markdown file with YAML frontmatter
 */
function parseAgentFile(filePath) {
  try {
    const content = readFileSync(filePath, 'utf8');
    
    // Extract YAML frontmatter and markdown body
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    
    if (!frontmatterMatch) {
      throw new Error(`Invalid agent file format: ${filePath}`);
    }

    const [, frontmatter, body] = frontmatterMatch;
    
    // Parse YAML frontmatter (simple parsing - just extract key fields)
    const description = frontmatter.match(/description:\s*(.+)/)?.[1]?.trim() || '';
    const toolsMatch = frontmatter.match(/tools:\s*\n((?:\s+-\s+.+\n?)+)/);
    const tools = toolsMatch 
      ? toolsMatch[1].split('\n').map(t => t.trim().replace(/^-\s+/, '')).filter(Boolean)
      : undefined;
    const model = frontmatter.match(/model:\s*(\w+)/)?.[1] || 'sonnet';

    return {
      description,
      prompt: body.trim(),
      tools,
      model
    };

  } catch (error) {
    console.error(`❌ Error loading agent file ${filePath}:`, error.message);
    throw error;
  }
}

export default loadAgentDefinitions;
