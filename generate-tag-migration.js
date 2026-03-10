/**
 * Generate SQL migration file from exported tags
 */

import { readFileSync, writeFileSync } from 'fs';

const data = JSON.parse(readFileSync('smart-tags-export.json', 'utf8'));

console.log(`📊 Generating SQL for ${data.total_count} grants...\n`);

const sql = data.tags.map(row => {
  const tags = JSON.stringify(row.smart_tags).replace(/'/g, "''"); // Escape single quotes
  return `UPDATE grants SET smart_tags = '${tags}'::jsonb WHERE grant_id = '${row.grant_id}';`;
}).join('\n');

const fullMigration = `-- Migration: Import smart_tags from Neon
-- Generated: ${new Date().toISOString()}
-- Total records: ${data.total_count}

BEGIN;

${sql}

COMMIT;
`;

writeFileSync('migrations/018_import_smart_tags.sql', fullMigration);

console.log('✅ Generated migrations/018_import_smart_tags.sql');
console.log(`   Size: ${(fullMigration.length / 1024).toFixed(1)} KB`);
console.log(`   Statements: ${data.total_count}\n`);
