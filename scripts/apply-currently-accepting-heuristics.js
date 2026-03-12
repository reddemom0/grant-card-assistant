/**
 * Apply Currently Accepting Heuristics
 *
 * Extracted from migration 004_grant_quality_fields.sql
 * This logic determines which grants are actually accepting applications
 * based on heuristics (name patterns, recently_changed text, is_active flag, staleness)
 *
 * Should be run after every database sync to re-populate:
 * - currently_accepting (BOOLEAN)
 * - exclusion_reason (TEXT)
 * - last_verified_at (TIMESTAMP)
 */

export async function applyCurrentlyAcceptingHeuristics(client) {
  console.log('🔨 Applying currently_accepting heuristics...');

  try {
    // Step A: Set everyone to true first (default)
    await client.query('UPDATE grants SET currently_accepting = true, last_verified_at = extracted_at');
    console.log('   ✅ Step A: Set all to currently_accepting = true');

    // Step B: Exclude garbage name prefixes (internal GetGranted archival convention)
    const resultB = await client.query(`
      UPDATE grants
      SET
        currently_accepting = false,
        exclusion_reason = 'Archived program (name prefix indicates internal archival: Z-COVID, Z-DUPLICATE, DORMANT, or replaced)'
      WHERE
        grant_name ILIKE '[Z-%'
        OR grant_name ILIKE '(Z-%'
        OR grant_name ILIKE 'Z-COVID%'
        OR grant_name ILIKE '%DORMANT%'
        OR grant_name ILIKE '%(DORMANT)%'
        OR grant_name ILIKE '%[DORMANT]%'
        OR grant_name ILIKE '%Replaced by%'
        OR grant_name ILIKE '%-DUPLICATE]%'
        OR grant_name ILIKE '%[Z-DUPLICATE]%'
    `);
    console.log(`   ✅ Step B: Excluded ${resultB.rowCount} grants with garbage name prefixes`);

    // Step C: Exclude grants where recently_changed explicitly says closed/at capacity
    const resultC = await client.query(`
      UPDATE grants
      SET
        currently_accepting = false,
        exclusion_reason = 'recently_changed indicates program is no longer accepting applications'
      WHERE
        currently_accepting = true
        AND recently_changed IS NOT NULL
        AND (
          recently_changed ILIKE '%no longer accepting%'
          OR recently_changed ILIKE '%no longer be accepting%'
          OR recently_changed ILIKE '%at capacity%'
          OR recently_changed ILIKE '%fully allocated%'
          OR recently_changed ILIKE '%program is closed%'
          OR recently_changed ILIKE '%program has been closed%'
          OR recently_changed ILIKE '%intake is closed%'
          OR recently_changed ILIKE '%intake has closed%'
          OR recently_changed ILIKE '%applications are closed%'
          OR recently_changed ILIKE '%applications closed%'
          OR recently_changed ILIKE '%application intake is closed%'
          OR recently_changed ILIKE '%funding exhausted%'
          OR recently_changed ILIKE '%program has ended%'
          OR recently_changed ILIKE '%program has been cancelled%'
          OR recently_changed ILIKE '%program is cancelled%'
          OR recently_changed ILIKE '%no longer available%'
          OR recently_changed ILIKE '%not currently accepting%'
          OR recently_changed ILIKE '%temporarily closed%'
          OR recently_changed ILIKE '%paused%'
        )
    `);
    console.log(`   ✅ Step C: Excluded ${resultC.rowCount} grants with closure language in recently_changed`);

    // Step D: Exclude grants that GetGranted itself marked inactive
    const resultD = await client.query(`
      UPDATE grants
      SET
        currently_accepting = false,
        exclusion_reason = COALESCE(exclusion_reason, 'Marked inactive by GetGranted (is_active = false)')
      WHERE
        currently_accepting = true
        AND is_active = false
    `);
    console.log(`   ✅ Step D: Excluded ${resultD.rowCount} grants marked inactive by GetGranted`);

    // Step E: Exclude grants not updated since 2022 (4+ years stale)
    const resultE = await client.query(`
      UPDATE grants
      SET
        currently_accepting = false,
        exclusion_reason = COALESCE(exclusion_reason, 'Last updated before 2022 — program has not been reviewed in 4+ years and is likely discontinued')
      WHERE
        currently_accepting = true
        AND last_updated IS NOT NULL
        AND last_updated < '2022/01/01'
    `);
    console.log(`   ✅ Step E: Excluded ${resultE.rowCount} stale grants (last_updated < 2022)`);

    // Get final counts
    const counts = await client.query(`
      SELECT
        currently_accepting,
        COUNT(*) as count
      FROM grants
      GROUP BY currently_accepting
      ORDER BY currently_accepting
    `);

    const falsepositives = await client.query(`
      SELECT COUNT(*) as count
      FROM grants
      WHERE is_active = true AND currently_accepting = false
    `);

    console.log(`   ✅ Heuristics applied:`);
    console.log(`      Currently accepting: ${counts.rows.find(r => r.currently_accepting === true)?.count || 0}`);
    console.log(`      Excluded: ${counts.rows.find(r => r.currently_accepting === false)?.count || 0}`);
    console.log(`      False positives caught: ${falsepositives.rows[0].count}`);

    return {
      accepting: parseInt(counts.rows.find(r => r.currently_accepting === true)?.count || 0),
      excluded: parseInt(counts.rows.find(r => r.currently_accepting === false)?.count || 0),
      falsepositives: parseInt(falsepositives.rows[0].count)
    };

  } catch (error) {
    console.error('   ❌ Error applying heuristics:', error);
    throw error;
  }
}
