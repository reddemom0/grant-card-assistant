#!/usr/bin/env node
/**
 * Test script for Memory Tool functionality
 * Tests all memory commands: view, create, str_replace, insert, delete, rename
 */

import {
  viewMemory,
  createMemory,
  strReplaceMemory,
  insertMemory,
  deleteMemory,
  renameMemory,
  executeMemoryCommand,
  MEMORY_BASE_DIR
} from './src/memory-tool.js';
import fs from 'fs/promises';

async function runTests() {
  console.log('======================================');
  console.log('Memory Tool Test Suite');
  console.log('======================================');
  console.log(`Memory Directory: ${MEMORY_BASE_DIR}\n`);

  let testsPassed = 0;
  let testsFailed = 0;

  // Helper function to run a test
  async function test(name, fn) {
    try {
      await fn();
      console.log(`✅ ${name}`);
      testsPassed++;
    } catch (error) {
      console.log(`❌ ${name}`);
      console.log(`   Error: ${error.message}`);
      testsFailed++;
    }
  }

  // Clean up test directory
  try {
    await fs.rm(MEMORY_BASE_DIR, { recursive: true, force: true });
  } catch (error) {
    // Ignore if doesn't exist
  }

  // Test 1: Create a file
  await test('Create file', async () => {
    const result = await createMemory('/memories/test.txt', 'Hello, World!\nThis is a test file.');
    if (!result.includes('File created')) throw new Error('Unexpected result');
  });

  // Test 2: View directory
  await test('View directory', async () => {
    const result = await viewMemory('/memories');
    if (!result.includes('test.txt')) throw new Error('File not listed');
  });

  // Test 3: View file contents
  await test('View file contents', async () => {
    const result = await viewMemory('/memories/test.txt');
    if (!result.includes('Hello, World!')) throw new Error('Content mismatch');
  });

  // Test 4: View file with line range
  await test('View file with line range', async () => {
    const result = await viewMemory('/memories/test.txt', [1, 1]);
    if (result !== 'Hello, World!') throw new Error('Line range failed');
  });

  // Test 5: String replace
  await test('String replace', async () => {
    await strReplaceMemory('/memories/test.txt', 'World', 'Memory Tool');
    const result = await viewMemory('/memories/test.txt');
    if (!result.includes('Hello, Memory Tool!')) throw new Error('Replace failed');
  });

  // Test 6: Insert text
  await test('Insert text at line', async () => {
    await insertMemory('/memories/test.txt', 2, 'Inserted line here.');
    const result = await viewMemory('/memories/test.txt');
    if (!result.includes('Inserted line here.')) throw new Error('Insert failed');
  });

  // Test 7: Create nested file
  await test('Create nested file', async () => {
    await createMemory('/memories/projects/notes.md', '# Project Notes\n\n- Item 1\n- Item 2');
    const result = await viewMemory('/memories/projects/notes.md');
    if (!result.includes('# Project Notes')) throw new Error('Nested file creation failed');
  });

  // Test 8: Rename file
  await test('Rename file', async () => {
    await renameMemory('/memories/test.txt', '/memories/renamed.txt');
    const result = await viewMemory('/memories');
    if (!result.includes('renamed.txt') || result.includes('test.txt')) {
      throw new Error('Rename failed');
    }
  });

  // Test 9: Delete file
  await test('Delete file', async () => {
    await deleteMemory('/memories/renamed.txt');
    const result = await viewMemory('/memories');
    if (result.includes('renamed.txt')) throw new Error('Delete failed');
  });

  // Test 10: Execute command interface
  await test('Execute command interface', async () => {
    const result = await executeMemoryCommand({
      command: 'create',
      path: '/memories/command-test.txt',
      file_text: 'Testing command interface'
    });
    if (!result.includes('File created')) throw new Error('Command interface failed');
  });

  // Test 11: Path traversal protection
  await test('Path traversal protection', async () => {
    try {
      await viewMemory('/memories/../../../etc/passwd');
      throw new Error('Path traversal not blocked!');
    } catch (error) {
      if (!error.message.includes('traversal')) throw error;
    }
  });

  // Test 12: Invalid path protection
  await test('Invalid path protection', async () => {
    try {
      await viewMemory('/etc/passwd');
      throw new Error('Invalid path not blocked!');
    } catch (error) {
      if (!error.message.includes('must start with /memories')) throw error;
    }
  });

  // Test 13: Error handling - file not found
  await test('Error handling: file not found', async () => {
    const result = await executeMemoryCommand({
      command: 'view',
      path: '/memories/nonexistent.txt'
    });
    if (!result.includes('Error:') || !result.includes('not found')) {
      throw new Error('Error not handled correctly');
    }
  });

  // Summary
  console.log('\n======================================');
  console.log('Test Results');
  console.log('======================================');
  console.log(`Tests Passed: ${testsPassed}`);
  console.log(`Tests Failed: ${testsFailed}`);
  console.log(`Total: ${testsPassed + testsFailed}`);

  if (testsFailed === 0) {
    console.log('\n✅ All tests passed!');
    process.exit(0);
  } else {
    console.log(`\n❌ ${testsFailed} test(s) failed`);
    process.exit(1);
  }
}

runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
