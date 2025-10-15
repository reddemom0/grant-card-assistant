/**
 * Memory Tool Handler for Grant Card Assistant
 *
 * Implements client-side memory tool for persistent knowledge across conversations.
 * Supports commands: view, create, str_replace, insert, delete, rename
 *
 * Security: All paths are validated to prevent directory traversal attacks.
 * All operations are restricted to /memories directory.
 */

const fs = require('fs').promises;
const path = require('path');

// Memory base directory (in project root)
const MEMORY_BASE_DIR = path.join(__dirname, '..', 'memories');

// Maximum file size for memory files (1MB)
const MAX_FILE_SIZE = 1024 * 1024;

// Initialize memory directory structure
async function initializeMemoryDirectories() {
  const directories = [
    path.join(MEMORY_BASE_DIR, 'user_feedback'),
    path.join(MEMORY_BASE_DIR, 'projects', 'active'),
    path.join(MEMORY_BASE_DIR, 'projects', 'completed'),
    path.join(MEMORY_BASE_DIR, 'knowledge_base', 'grant_patterns'),
    path.join(MEMORY_BASE_DIR, 'knowledge_base', 'eligibility_rules'),
    path.join(MEMORY_BASE_DIR, 'knowledge_base', 'common_issues'),
    path.join(MEMORY_BASE_DIR, 'sessions')
  ];

  for (const dir of directories) {
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      console.error(`Failed to create directory ${dir}:`, error);
    }
  }
}

/**
 * Validates and resolves a memory path
 * Prevents path traversal attacks
 *
 * @param {string} requestedPath - Path from memory tool (e.g., "/memories/user_feedback/corrections.xml")
 * @returns {string} - Absolute file system path
 * @throws {Error} - If path is invalid or attempts traversal
 */
function validatePath(requestedPath) {
  // Must start with /memories
  if (!requestedPath.startsWith('/memories')) {
    throw new Error('Invalid path: must start with /memories');
  }

  // Convert to absolute path and resolve
  const absolutePath = path.join(MEMORY_BASE_DIR, requestedPath.replace('/memories', ''));
  const resolvedPath = path.resolve(absolutePath);

  // Verify it's still within memory directory
  if (!resolvedPath.startsWith(MEMORY_BASE_DIR)) {
    throw new Error('Path traversal detected');
  }

  return resolvedPath;
}

/**
 * VIEW command: Read contents of a memory file
 *
 * @param {object} input - { path: "/memories/user_feedback/corrections.xml" }
 * @returns {object} - { success: true, content: "file contents" } or error
 */
async function handleView(input) {
  try {
    const filePath = validatePath(input.path);

    // Check if file exists
    try {
      await fs.access(filePath);
    } catch {
      return {
        success: false,
        error: `File not found: ${input.path}`
      };
    }

    // Read file contents
    const content = await fs.readFile(filePath, 'utf-8');

    return {
      success: true,
      content: content
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * CREATE command: Create a new memory file
 *
 * @param {object} input - { path: "/memories/...", content: "..." }
 * @returns {object} - { success: true } or error
 */
async function handleCreate(input) {
  try {
    const filePath = validatePath(input.path);

    // Check if file already exists
    try {
      await fs.access(filePath);
      return {
        success: false,
        error: `File already exists: ${input.path}. Use str_replace to modify.`
      };
    } catch {
      // File doesn't exist, proceed with creation
    }

    // Ensure directory exists
    const dirPath = path.dirname(filePath);
    await fs.mkdir(dirPath, { recursive: true });

    // Check content size
    if (input.content.length > MAX_FILE_SIZE) {
      return {
        success: false,
        error: `Content exceeds maximum file size (${MAX_FILE_SIZE} bytes)`
      };
    }

    // Write file
    await fs.writeFile(filePath, input.content, 'utf-8');

    console.log(`📝 Memory created: ${input.path}`);

    return {
      success: true,
      message: `Created ${input.path}`
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * STR_REPLACE command: Replace content in a memory file
 *
 * @param {object} input - { path: "...", old_str: "...", new_str: "..." }
 * @returns {object} - { success: true } or error
 */
async function handleStrReplace(input) {
  try {
    const filePath = validatePath(input.path);

    // Check if file exists
    let content;
    try {
      content = await fs.readFile(filePath, 'utf-8');
    } catch {
      return {
        success: false,
        error: `File not found: ${input.path}`
      };
    }

    // Perform replacement
    if (!content.includes(input.old_str)) {
      return {
        success: false,
        error: `String not found in file: "${input.old_str}"`
      };
    }

    const newContent = content.replace(input.old_str, input.new_str);

    // Check new content size
    if (newContent.length > MAX_FILE_SIZE) {
      return {
        success: false,
        error: `Modified content exceeds maximum file size (${MAX_FILE_SIZE} bytes)`
      };
    }

    // Write updated content
    await fs.writeFile(filePath, newContent, 'utf-8');

    console.log(`✏️ Memory updated: ${input.path}`);

    return {
      success: true,
      message: `Updated ${input.path}`
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * INSERT command: Insert content at a specific line
 *
 * @param {object} input - { path: "...", line: 5, content: "..." }
 * @returns {object} - { success: true } or error
 */
async function handleInsert(input) {
  try {
    const filePath = validatePath(input.path);

    // Check if file exists
    let content;
    try {
      content = await fs.readFile(filePath, 'utf-8');
    } catch {
      return {
        success: false,
        error: `File not found: ${input.path}`
      };
    }

    // Split into lines
    const lines = content.split('\n');

    // Validate line number
    if (input.line < 0 || input.line > lines.length) {
      return {
        success: false,
        error: `Invalid line number: ${input.line}. File has ${lines.length} lines.`
      };
    }

    // Insert content
    lines.splice(input.line, 0, input.content);
    const newContent = lines.join('\n');

    // Check new content size
    if (newContent.length > MAX_FILE_SIZE) {
      return {
        success: false,
        error: `Modified content exceeds maximum file size (${MAX_FILE_SIZE} bytes)`
      };
    }

    // Write updated content
    await fs.writeFile(filePath, newContent, 'utf-8');

    console.log(`➕ Memory updated: ${input.path} (inserted at line ${input.line})`);

    return {
      success: true,
      message: `Inserted content at line ${input.line} in ${input.path}`
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * DELETE command: Delete a memory file
 *
 * @param {object} input - { path: "/memories/..." }
 * @returns {object} - { success: true } or error
 */
async function handleDelete(input) {
  try {
    const filePath = validatePath(input.path);

    // Check if file exists
    try {
      await fs.access(filePath);
    } catch {
      return {
        success: false,
        error: `File not found: ${input.path}`
      };
    }

    // Delete file
    await fs.unlink(filePath);

    console.log(`🗑️ Memory deleted: ${input.path}`);

    return {
      success: true,
      message: `Deleted ${input.path}`
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * RENAME command: Rename or move a memory file
 *
 * @param {object} input - { old_path: "...", new_path: "..." }
 * @returns {object} - { success: true } or error
 */
async function handleRename(input) {
  try {
    const oldPath = validatePath(input.old_path);
    const newPath = validatePath(input.new_path);

    // Check if old file exists
    try {
      await fs.access(oldPath);
    } catch {
      return {
        success: false,
        error: `File not found: ${input.old_path}`
      };
    }

    // Check if new file already exists
    try {
      await fs.access(newPath);
      return {
        success: false,
        error: `Destination already exists: ${input.new_path}`
      };
    } catch {
      // New path doesn't exist, proceed
    }

    // Ensure destination directory exists
    const newDir = path.dirname(newPath);
    await fs.mkdir(newDir, { recursive: true });

    // Rename/move file
    await fs.rename(oldPath, newPath);

    console.log(`📁 Memory renamed: ${input.old_path} → ${input.new_path}`);

    return {
      success: true,
      message: `Renamed ${input.old_path} to ${input.new_path}`
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Main handler for memory tool operations
 * Routes commands to appropriate handlers
 *
 * @param {string} command - Memory command (view, create, str_replace, insert, delete, rename)
 * @param {object} input - Command-specific input
 * @returns {object} - Result object with success status and data/error
 */
async function handleMemoryTool(command, input) {
  console.log(`🧠 Memory tool command: ${command}`, input);

  switch (command) {
    case 'view':
      return await handleView(input);

    case 'create':
      return await handleCreate(input);

    case 'str_replace':
      return await handleStrReplace(input);

    case 'insert':
      return await handleInsert(input);

    case 'delete':
      return await handleDelete(input);

    case 'rename':
      return await handleRename(input);

    default:
      return {
        success: false,
        error: `Unknown memory command: ${command}`
      };
  }
}

// Initialize memory directories on module load
initializeMemoryDirectories().catch(console.error);

module.exports = {
  handleMemoryTool,
  validatePath,
  MEMORY_BASE_DIR
};
