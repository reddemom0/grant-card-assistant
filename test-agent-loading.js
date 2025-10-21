// Test to verify agent definitions are loading correctly
import { loadAgentDefinitions } from './src/load-agents.js';

const agents = loadAgentDefinitions();

console.log('=== LOADED AGENTS ===\n');

for (const [name, def] of Object.entries(agents)) {
  console.log(`\n📋 Agent: ${name}`);
  console.log(`Description: ${def.description.substring(0, 80)}...`);
  console.log(`Prompt length: ${def.prompt.length} chars`);
  console.log(`Prompt preview (first 200 chars):`);
  console.log(def.prompt.substring(0, 200));
  console.log(`Tools: ${def.tools?.join(', ') || 'default'}`);
  console.log(`Model: ${def.model}`);
  console.log('─'.repeat(80));
}
