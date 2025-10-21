import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('🧪 Testing Claude Code CLI directly...\n');

// Try to find the CLI
const cliPath = join(__dirname, 'node_modules', '.bin', 'claude');
console.log('CLI path:', cliPath);

// Try to spawn it with --version
const child = spawn(cliPath, ['--version'], {
  env: {
    ...process.env,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY
  }
});

let stdout = '';
let stderr = '';

child.stdout.on('data', (data) => {
  stdout += data.toString();
  console.log('STDOUT:', data.toString());
});

child.stderr.on('data', (data) => {
  stderr += data.toString();
  console.error('STDERR:', data.toString());
});

child.on('error', (error) => {
  console.error('❌ Failed to spawn:', error.message);
});

child.on('close', (code) => {
  console.log('\n📊 Process exited with code:', code);
  console.log('Full stdout:', stdout);
  console.log('Full stderr:', stderr);
});

setTimeout(() => {
  console.log('⏱️ Timeout - killing process');
  child.kill();
}, 5000);
