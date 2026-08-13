/**
 * Endpoint to import GetGranted grants from JSON export
 * Usage: GET /import-grants?secret=<JWT_SECRET>
 *
 * After importing rows, runs the quality classification logic to populate
 * currently_accepting, exclusion_reason, and last_verified_at for every grant.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query } from './src/database/connection.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Closed-status phrases detected in recently_changed ───────────────────────
// IMPORTANT: match substrings against the lowercased recently_changed text.
// Phrase order doesn't matter — all are checked.
const CLOSED_PHRASES = [
  'no longer accepting',        // "is no longer accepting applications"
  'no longer be accepting',     // "will no longer be accepting applications" (DigitalWorks pattern)
  'no longer accepting applications',
  'at capacity',
  'program is closed',
  'program has been closed',
  'intake is closed',
  'intake has closed',
  'applications are closed',
  'applications closed',
  'application intake is closed',
  'funding exhausted',
  'funding has been fully allocated',
  'fully allocated',
  'program has ended',
  'program has been cancelled',
  'program is cancelled',
  'no longer available',
  'not currently accepting',
  'temporarily closed',
  'paused',                     // catch "applications are paused"
];

// ── Name patterns indicating archived/internal records ───────────────────────
const ARCHIVED_NAME_PREFIXES = ['[z-', '(z-', 'z-covid'];
const ARCHIVED_NAME_SUBSTRINGS = ['dormant', '[z-duplicate]', 'replaced by', '-duplicate]'];

/**
 * Determine whether a grant is currently accepting applications.
 * Returns { currentlyAccepting: boolean, exclusionReason: string|null }
 */
function classifyGrant(grant) {
  const name = (grant.grant_name || '').toLowerCase();
  const rc = (grant.recently_changed || '').toLowerCase();

  // 1. Garbage name prefixes (internal GetGranted archival convention)
  const hasArchivedPrefix = ARCHIVED_NAME_PREFIXES.some(p => name.startsWith(p));
  const hasArchivedSubstring = ARCHIVED_NAME_SUBSTRINGS.some(s => name.includes(s));
  if (hasArchivedPrefix || hasArchivedSubstring) {
    return {
      currentlyAccepting: false,
      exclusionReason: 'Archived program (name prefix indicates internal archival: Z-COVID, Z-DUPLICATE, DORMANT, or replaced)'
    };
  }

  // 2. recently_changed explicitly says closed/at capacity
  const closedPhrase = CLOSED_PHRASES.find(p => rc.includes(p));
  if (closedPhrase) {
    return {
      currentlyAccepting: false,
      exclusionReason: `recently_changed indicates program is no longer accepting applications ("${closedPhrase}")`
    };
  }

  // 2b. full_page_text contains the GetGranted "This grant is inactive" badge.
  // GetGranted renders this as a UI element for grants where all spots are filled
  // or the program has ended — but does NOT reflect it in is_active or recently_changed.
  // The scraper captures the full page HTML-as-text, so we can detect it here.
  const fpt = (grant.full_page_text || '').toLowerCase();
  const inactiveBadgePhrases = [
    'this grant is inactive',
    'no longer active because all spots have been filled',
    'no longer active because the program has ended',
    'no longer active because the deadline has passed',
  ];
  const inactiveBadge = inactiveBadgePhrases.find(p => fpt.includes(p));
  if (inactiveBadge) {
    return {
      currentlyAccepting: false,
      exclusionReason: `GetGranted "inactive" badge detected in page text: "${inactiveBadge}"`
    };
  }

  // 3. GetGranted itself marked it inactive
  if (grant.is_active === false) {
    return {
      currentlyAccepting: false,
      exclusionReason: 'Marked inactive by GetGranted (is_active = false)'
    };
  }

  // 4. Last updated before 2022 — not reviewed in 4+ years, very likely discontinued.
  // 2022 cutoff catches early-COVID-era programs (2020-2021) while preserving
  // legitimate ongoing programs that may not update frequently.
  if (grant.last_updated && grant.last_updated < '2022/01/01') {
    return {
      currentlyAccepting: false,
      exclusionReason: 'Last updated before 2022 — program has not been reviewed in 4+ years and is likely discontinued'
    };
  }

  return { currentlyAccepting: true, exclusionReason: null };
}

export async function importGrantsEndpoint(req, res) {
  try {
    // Security check - use JWT_SECRET. Both sides are trimmed: the original
    // "JWT_SECRET newline issue" that led to this check being disabled was a
    // trailing newline on the env var, not a reason to run unauthenticated.
    // This endpoint runs `DELETE FROM grants` — it must never be open.
    const secret = (req.query.secret || '').trim();
    const expectedSecret = process.env.JWT_SECRET?.trim();

    // Fail closed if the secret is not configured, rather than comparing
    // two undefined values and passing.
    if (!expectedSecret || secret !== expectedSecret) {
      console.warn('🚫 /import-grants rejected: invalid or missing secret');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    console.log('📥 Starting GetGranted import...');

    // Read export file (use latest export with intake_cycle field)
    const exportPath = path.join(__dirname, 'data', 'getgranted-all-grants.json');

    if (!fs.existsSync(exportPath)) {
      return res.status(404).json({ error: 'Export file not found' });
    }

    const exportData = JSON.parse(fs.readFileSync(exportPath, 'utf-8'));
    console.log(`   Found ${exportData.total_grants} grants in export`);

    // Clear existing data
    console.log('   Clearing existing grants...');
    await query('DELETE FROM grants');

    // Import grants
    let imported = 0;
    let failed = 0;

    for (const grant of exportData.grants) {
      // Skip grants with errors
      if (grant.error) {
        failed++;
        continue;
      }

      // Classify this grant: is it currently accepting applications?
      const { currentlyAccepting, exclusionReason } = classifyGrant(grant);

      // Clean grant_type: strip "Grant Type\n      " prefix from scraper artifact
      const cleanGrantType = grant.grant_type
        ? grant.grant_type.replace(/^Grant Type\s+/i, '').trim()
        : grant.grant_type;

      try {
        await query(`
          INSERT INTO grants (
            grant_id, grant_name, grant_type, grant_amount, url,
            regions, industries, program_provider, deadline,
            max_spend, contribution_percentage, difficulty,
            grant_criteria, best_practices, recently_changed, full_page_text,
            last_updated, extracted_at, is_active, intake_cycle,
            currently_accepting, exclusion_reason, last_verified_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
          ON CONFLICT (grant_id) DO UPDATE SET
            grant_name = EXCLUDED.grant_name,
            grant_type = EXCLUDED.grant_type,
            grant_amount = EXCLUDED.grant_amount,
            url = EXCLUDED.url,
            regions = EXCLUDED.regions,
            industries = EXCLUDED.industries,
            program_provider = EXCLUDED.program_provider,
            deadline = EXCLUDED.deadline,
            max_spend = EXCLUDED.max_spend,
            contribution_percentage = EXCLUDED.contribution_percentage,
            difficulty = EXCLUDED.difficulty,
            grant_criteria = EXCLUDED.grant_criteria,
            best_practices = EXCLUDED.best_practices,
            recently_changed = EXCLUDED.recently_changed,
            full_page_text = EXCLUDED.full_page_text,
            last_updated = EXCLUDED.last_updated,
            extracted_at = EXCLUDED.extracted_at,
            is_active = EXCLUDED.is_active,
            intake_cycle = EXCLUDED.intake_cycle,
            currently_accepting = EXCLUDED.currently_accepting,
            exclusion_reason = EXCLUDED.exclusion_reason,
            last_verified_at = EXCLUDED.last_verified_at,
            updated_at = NOW()
        `, [
          grant.grant_id,
          grant.grant_name,
          cleanGrantType,
          grant.grant_amount,
          grant.url,
          grant.regions,
          grant.industries,
          grant.program_provider,
          grant.deadline,
          grant.max_spend,
          grant.contribution_percentage,
          grant.difficulty,
          grant.grant_criteria,
          grant.best_practices,
          grant.recently_changed,
          grant.full_page_text,
          grant.last_updated,
          grant.extracted_at,
          grant.is_active,
          grant.intake_cycle || null,
          currentlyAccepting,
          exclusionReason,
          grant.extracted_at  // last_verified_at = when it was scraped
        ]);

        imported++;
      } catch (error) {
        console.error(`Failed to import grant ${grant.grant_id}:`, error.message);
        failed++;
      }
    }

    // Verify import
    const countResult = await query('SELECT COUNT(*) as count FROM grants');
    const activeResult = await query('SELECT COUNT(*) as count FROM grants WHERE is_active = true');
    const inactiveResult = await query('SELECT COUNT(*) as count FROM grants WHERE is_active = false');
    const acceptingResult = await query('SELECT COUNT(*) as count FROM grants WHERE currently_accepting = true');

    // Sample the exclusion reasons for reporting
    const exclusionSummary = await query(`
      SELECT exclusion_reason, COUNT(*) as count
      FROM grants
      WHERE currently_accepting = false AND exclusion_reason IS NOT NULL
      GROUP BY exclusion_reason
      ORDER BY count DESC
      LIMIT 10
    `);

    const result = {
      success: true,
      timestamp: new Date().toISOString(),
      source: {
        total_grants: exportData.total_grants,
        exported_at: exportData.exported_at
      },
      import: {
        imported,
        failed
      },
      database: {
        total: parseInt(countResult.rows[0].count),
        is_active_true: parseInt(activeResult.rows[0].count),
        is_active_false: parseInt(inactiveResult.rows[0].count),
        currently_accepting: parseInt(acceptingResult.rows[0].count),
        excluded: parseInt(countResult.rows[0].count) - parseInt(acceptingResult.rows[0].count),
        exclusion_breakdown: exclusionSummary.rows
      }
    };

    console.log('✅ Import complete:', result);

    return res.status(200).json(result);

  } catch (error) {
    console.error('❌ Import failed:', error);
    return res.status(500).json({
      error: 'Import failed',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}
