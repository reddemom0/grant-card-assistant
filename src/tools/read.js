/**
 * Read File Tool
 * Reads files from filesystem with line numbers and range support
 */

import { readFileSync, existsSync, statSync } from 'fs';

export async function readFile({ file_path, offset, limit }) {
  // Validate file exists
  if (!existsSync(file_path)) {
    throw new Error(`File not found: ${file_path}`);
  }

  // Check if it's a directory
  const stats = statSync(file_path);
  if (stats.isDirectory()) {
    throw new Error(`Path is a directory, not a file: ${file_path}`);
  }

  // Read file content
  const content = readFileSync(file_path, 'utf8');
  const lines = content.split('\n');

  // Apply offset and limit
  const startLine = offset ? offset - 1 : 0; // Convert to 0-indexed
  const endLine = limit ? startLine + limit : lines.length;
  const selectedLines = lines.slice(startLine, endLine);

  // Format with line numbers (using original line numbers)
  const formattedLines = selectedLines.map((line, index) => {
    const lineNumber = startLine + index + 1;
    return `${lineNumber.toString().padStart(5)}→${line}`;
  }).join('\n');

  return {
    file_path,
    total_lines: lines.length,
    lines_returned: selectedLines.length,
    start_line: startLine + 1,
    end_line: Math.min(endLine, lines.length),
    content: formattedLines
  };
}
