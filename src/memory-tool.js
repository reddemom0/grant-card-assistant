/**
 * Memory Tool Implementation
 * Client-side memory store for Agent SDK with filesystem-based persistence
 * Implements all memory commands: view, create, str_replace, insert, delete, rename
 */

import fs from 'fs/promises';
import {  dirname, join, resolve } from 'path';

// Memory directory base path (relative to project root)
const MEMORY_BASE_DIR = join(process.cwd(), '.memories');

/**
 * Validate and normalize memory path to prevent directory traversal attacks
 * @param {string} memoryPath - The path to validate (must start with /memories)
 * @returns {string} Absolute filesystem path
 * @throws {Error} If path is invalid or attempts traversal
 */
function validateMemoryPath(memoryPath) {
  // Ensure path starts with /memories
  if (!memoryPath.startsWith('/memories')) {
    throw new Error('Memory paths must start with /memories');
  }

  // Remove /memories prefix and normalize
  const relativePath = memoryPath.substring('/memories'.length) || '/';

  // Resolve to absolute path
  const absolutePath = join(MEMORY_BASE_DIR, relativePath);
  const resolvedPath = resolve(absolutePath);

  // Verify resolved path is still within memory directory
  if (!resolvedPath.startsWith(MEMORY_BASE_DIR)) {
    throw new Error('Invalid path: directory traversal detected');
  }

  // Check for traversal sequences
  if (memoryPath.includes('../') || memoryPath.includes('..\\') || memoryPath.includes('%2e%2e')) {
    throw new Error('Invalid path: traversal sequences not allowed');
  }

  return resolvedPath;
}

/**
 * Ensure memory base directory exists
 */
async function ensureMemoryDir() {
  try {
    await fs.mkdir(MEMORY_BASE_DIR, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }
}

/**
 * View command: List directory contents or view file contents with optional line range
 * @param {string} path - The path to view
 * @param {array} viewRange - Optional [start, end] line numbers (1-indexed)
 * @returns {string} Directory listing or file contents
 */
export async function viewMemory(path, viewRange = null) {
  await ensureMemoryDir();
  const fsPath = validateMemoryPath(path);

  try {
    const stats = await fs.stat(fsPath);

    if (stats.isDirectory()) {
      // List directory contents
      const entries = await fs.readdir(fsPath, { withFileTypes: true });
      const items = entries.map(entry => {
        const prefix = entry.isDirectory() ? '[DIR] ' : '';
        return `${prefix}${entry.name}`;
      });

      if (items.length === 0) {
        return `Directory: ${path}\n(empty)`;
      }

      return `Directory: ${path}\n${items.map(item => `- ${item}`).join('\n')}`;
    } else {
      // Read file contents
      const content = await fs.readFile(fsPath, 'utf-8');
      const lines = content.split('\n');

      if (viewRange) {
        const [start, end] = viewRange;
        // 1-indexed, inclusive
        const selectedLines = lines.slice(start - 1, end);
        return selectedLines.join('\n');
      }

      return content;
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`Path not found: ${path}`);
    }
    throw error;
  }
}

/**
 * Create command: Create or overwrite a file with content
 * @param {string} path - The file path to create
 * @param {string} fileText - The content to write
 * @returns {string} Success message
 */
export async function createMemory(path, fileText) {
  await ensureMemoryDir();
  const fsPath = validateMemoryPath(path);

  // Ensure parent directory exists
  const parentDir = dirname(fsPath);
  await fs.mkdir(parentDir, { recursive: true });

  // Write file
  await fs.writeFile(fsPath, fileText, 'utf-8');

  return `File created: ${path}`;
}

/**
 * str_replace command: Replace exact text in a file
 * @param {string} path - The file path
 * @param {string} oldStr - The exact string to replace
 * @param {string} newStr - The replacement string
 * @returns {string} Success message
 */
export async function strReplaceMemory(path, oldStr, newStr) {
  await ensureMemoryDir();
  const fsPath = validateMemoryPath(path);

  try {
    // Read file
    const content = await fs.readFile(fsPath, 'utf-8');

    // Check if old string exists
    if (!content.includes(oldStr)) {
      throw new Error(`String not found in file: "${oldStr.substring(0, 50)}..."`);
    }

    // Replace and write
    const newContent = content.replace(oldStr, newStr);
    await fs.writeFile(fsPath, newContent, 'utf-8');

    return `File updated: ${path}`;
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`File not found: ${path}`);
    }
    throw error;
  }
}

/**
 * Insert command: Insert text at a specific line number
 * @param {string} path - The file path
 * @param {number} insertLine - Line number to insert at (1-indexed)
 * @param {string} insertText - Text to insert
 * @returns {string} Success message
 */
export async function insertMemory(path, insertLine, insertText) {
  await ensureMemoryDir();
  const fsPath = validateMemoryPath(path);

  try {
    // Read file
    const content = await fs.readFile(fsPath, 'utf-8');
    const lines = content.split('\n');

    // Insert at line (1-indexed)
    lines.splice(insertLine - 1, 0, insertText.trimEnd());

    // Write back
    const newContent = lines.join('\n');
    await fs.writeFile(fsPath, newContent, 'utf-8');

    return `Text inserted at line ${insertLine} in ${path}`;
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`File not found: ${path}`);
    }
    throw error;
  }
}

/**
 * Delete command: Delete a file or directory
 * @param {string} path - The path to delete
 * @returns {string} Success message
 */
export async function deleteMemory(path) {
  await ensureMemoryDir();
  const fsPath = validateMemoryPath(path);

  try {
    const stats = await fs.stat(fsPath);

    if (stats.isDirectory()) {
      await fs.rm(fsPath, { recursive: true, force: true });
      return `Directory deleted: ${path}`;
    } else {
      await fs.unlink(fsPath);
      return `File deleted: ${path}`;
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`Path not found: ${path}`);
    }
    throw error;
  }
}

/**
 * Rename command: Rename or move a file/directory
 * @param {string} oldPath - Current path
 * @param {string} newPath - New path
 * @returns {string} Success message
 */
export async function renameMemory(oldPath, newPath) {
  await ensureMemoryDir();
  const oldFsPath = validateMemoryPath(oldPath);
  const newFsPath = validateMemoryPath(newPath);

  try {
    // Ensure parent directory of new path exists
    const newParentDir = dirname(newFsPath);
    await fs.mkdir(newParentDir, { recursive: true });

    // Rename/move
    await fs.rename(oldFsPath, newFsPath);

    return `Renamed: ${oldPath} → ${newPath}`;
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`Source path not found: ${oldPath}`);
    }
    throw error;
  }
}

/**
 * Execute a memory tool command
 * @param {object} toolInput - Tool input with command and parameters
 * @returns {Promise<string>} Result of the command
 */
export async function executeMemoryCommand(toolInput) {
  const { command, path: memPath, view_range, file_text, old_str, new_str,
          insert_line, insert_text, old_path, new_path } = toolInput;

  try {
    switch (command) {
      case 'view':
        return await viewMemory(memPath, view_range);

      case 'create':
        if (!file_text && file_text !== '') {
          throw new Error('Missing required parameter: file_text');
        }
        return await createMemory(memPath, file_text);

      case 'str_replace':
        if (!old_str || !new_str) {
          throw new Error('Missing required parameters: old_str, new_str');
        }
        return await strReplaceMemory(memPath, old_str, new_str);

      case 'insert':
        if (insert_line === undefined || !insert_text) {
          throw new Error('Missing required parameters: insert_line, insert_text');
        }
        return await insertMemory(memPath, insert_line, insert_text);

      case 'delete':
        return await deleteMemory(memPath);

      case 'rename':
        if (!old_path || !new_path) {
          throw new Error('Missing required parameters: old_path, new_path');
        }
        return await renameMemory(old_path, new_path);

      default:
        throw new Error(`Unknown memory command: ${command}`);
    }
  } catch (error) {
    // Return error message in format Claude expects
    return `Error: ${error.message}`;
  }
}

/**
 * Get memory tool definition for Agent SDK
 * @returns {object} Memory tool definition
 */
export function getMemoryToolDefinition() {
  return {
    type: 'memory_20250818',
    name: 'memory'
  };
}

// Export MEMORY_BASE_DIR for testing
export { MEMORY_BASE_DIR };

export default {
  viewMemory,
  createMemory,
  strReplaceMemory,
  insertMemory,
  deleteMemory,
  renameMemory,
  executeMemoryCommand,
  getMemoryToolDefinition,
  MEMORY_BASE_DIR
};
