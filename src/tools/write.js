/**
 * Write File Tool
 * Creates or overwrites files
 */

import { writeFileSync, mkdirSync, dirname, existsSync } from 'fs';

export async function writeFile({ file_path, content }) {
  try {
    // Create directory if it doesn't exist
    const dir = dirname(file_path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Write file
    writeFileSync(file_path, content, 'utf8');

    const lines = content.split('\n').length;

    return {
      file_path,
      bytes_written: Buffer.byteLength(content, 'utf8'),
      lines_written: lines,
      message: `Successfully wrote ${lines} lines to ${file_path}`
    };
  } catch (error) {
    throw new Error(`Failed to write file: ${error.message}`);
  }
}
