import { getToolsForAgent } from '../../src/tools/definitions.js';

const tools = getToolsForAgent('internal-oracle');
console.log(`\nTotal tools in Oracle set: ${tools.length}\n`);
tools.forEach((t, i) => console.log(`  ${String(i + 1).padStart(2)}. ${t.name}`));

const hasListOwners = tools.some(t => t.name === 'list_hubspot_owners');
console.log(`\nlist_hubspot_owners present? ${hasListOwners ? 'YES' : 'NO'}`);
