/**
 * Generate Tool Embeddings for Semantic Search
 *
 * This script creates embeddings for all tools using sentence-transformers
 * (via Python subprocess). Embeddings are cached to reduce startup time.
 *
 * Run this script whenever tool definitions change:
 *   node scripts/generate-tool-embeddings.js
 */

import { ALL_TOOLS } from '../src/tools/definitions.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EMBEDDINGS_FILE = path.join(__dirname, '../src/tools/tool-embeddings.json');
const EMBEDDING_MODEL = 'sentence-transformers/all-MiniLM-L6-v2';

/**
 * Convert tool definition to searchable text representation
 */
function toolToText(tool) {
  const parts = [
    `Tool: ${tool.name}`,
    `Description: ${tool.description}`
  ];

  // Add parameter information if available
  if (tool.input_schema?.properties) {
    const params = tool.input_schema.properties;
    const paramDescriptions = [];

    for (const [paramName, paramInfo] of Object.entries(params)) {
      const paramDesc = paramInfo.description || '';
      const paramType = paramInfo.type || '';
      paramDescriptions.push(`${paramName} (${paramType}): ${paramDesc}`);
    }

    if (paramDescriptions.length > 0) {
      parts.push('Parameters: ' + paramDescriptions.join(', '));
    }
  }

  return parts.join('\n');
}

/**
 * Check if Python and sentence-transformers are available
 */
async function checkPythonDependencies() {
  try {
    console.log('Checking Python installation...');
    const { stdout: pythonVersion } = await execAsync('python3 --version');
    console.log(`✓ Found ${pythonVersion.trim()}`);

    console.log('Checking sentence-transformers...');
    await execAsync('python3 -c "import sentence_transformers"');
    console.log('✓ sentence-transformers installed');

    return true;
  } catch (error) {
    console.error('\n❌ Python dependencies not found!');
    console.error('\nTo install:');
    console.error('  pip3 install sentence-transformers');
    console.error('\nOr use the notebook approach from the examples.');
    return false;
  }
}

/**
 * Generate embeddings using Python sentence-transformers
 */
async function generateEmbeddings(toolTexts) {
  console.log(`\nGenerating embeddings for ${toolTexts.length} tools...`);

  // Create Python script for embedding generation
  const pythonScript = `
import sys
import json
from sentence_transformers import SentenceTransformer

# Load model
model = SentenceTransformer('${EMBEDDING_MODEL}')

# Read tool texts from stdin
tool_texts = json.loads(sys.stdin.read())

# Generate embeddings
embeddings = model.encode(tool_texts, convert_to_numpy=True)

# Convert to list for JSON serialization
embeddings_list = embeddings.tolist()

# Output as JSON
print(json.dumps(embeddings_list))
`;

  try {
    const { stdout } = await execAsync(
      `python3 -c '${pythonScript.replace(/'/g, "'\\''")}' <<< '${JSON.stringify(toolTexts).replace(/'/g, "'\\''")}' `
    );

    const embeddings = JSON.parse(stdout);
    console.log(`✓ Generated ${embeddings.length} embeddings`);
    console.log(`  Dimensions: ${embeddings[0].length}`);

    return embeddings;
  } catch (error) {
    console.error('Error generating embeddings:', error);
    throw error;
  }
}

/**
 * Main execution
 */
async function main() {
  console.log('='.repeat(80));
  console.log('Tool Embeddings Generator');
  console.log('='.repeat(80));

  // Check dependencies
  const depsOk = await checkPythonDependencies();
  if (!depsOk) {
    process.exit(1);
  }

  // Convert all tools to text
  console.log(`\nProcessing ${ALL_TOOLS.length} tool definitions...`);
  const toolTexts = ALL_TOOLS.map(tool => toolToText(tool));

  console.log('\nSample tool text:');
  console.log('-'.repeat(80));
  console.log(toolTexts[0]);
  console.log('-'.repeat(80));

  // Generate embeddings
  const embeddings = await generateEmbeddings(toolTexts);

  // Create output object
  const output = {
    model: EMBEDDING_MODEL,
    dimensions: embeddings[0].length,
    generatedAt: new Date().toISOString(),
    tools: ALL_TOOLS.map((tool, index) => ({
      name: tool.name,
      description: tool.description,
      type: tool.type || 'custom',
      text: toolTexts[index],
      embedding: embeddings[index]
    }))
  };

  // Save to file
  await fs.writeFile(EMBEDDINGS_FILE, JSON.stringify(output, null, 2));
  console.log(`\n✓ Saved embeddings to: ${EMBEDDINGS_FILE}`);
  console.log(`  File size: ${(await fs.stat(EMBEDDINGS_FILE)).size} bytes`);

  console.log('\n' + '='.repeat(80));
  console.log('✓ Tool embeddings generated successfully!');
  console.log('='.repeat(80));
  console.log('\nNext steps:');
  console.log('1. Commit tool-embeddings.json to git');
  console.log('2. Deploy the updated application');
  console.log('3. Tool search will use these embeddings automatically');
  console.log('\nRe-run this script whenever tool definitions change.');
}

main().catch(error => {
  console.error('\n❌ Error:', error);
  process.exit(1);
});
