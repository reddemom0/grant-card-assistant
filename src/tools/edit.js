/**
 * Edit File Tool
 * Performs exact string replacement in files
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';

export async function editFile({ file_path, old_string, new_string, replace_all = false }) {
  // Validate file exists
  if (!existsSync(file_path)) {
    throw new Error(`File not found: ${file_path}`);
  }

  // Read current content
  const content = readFileSync(file_path, 'utf8');

  // Check if old_string exists
  if (!content.includes(old_string)) {
    throw new Error(`String not found in file: "${old_string.substring(0, 50)}..."`);
  }

  // Count occurrences
  const occurrences = content.split(old_string).length - 1;

  // If not replace_all and multiple occurrences, throw error
  if (!replace_all && occurrences > 1) {
    throw new Error(
      `Found ${occurrences} occurrences of the string. ` +
      `Use replace_all: true to replace all, or provide a more unique string.`
    );
  }

  // Perform replacement
  let newContent;
  if (replace_all) {
    newContent = content.split(old_string).join(new_string);
  } else {
    newContent = content.replace(old_string, new_string);
  }

  // Write back to file
  writeFileSync(file_path, newContent, 'utf8');

  return {
    file_path,
    replacements_made: replace_all ? occurrences : 1,
    old_length: content.length,
    new_length: newContent.length,
    message: `Successfully replaced ${replace_all ? occurrences : 1} occurrence(s)`
  };
}
