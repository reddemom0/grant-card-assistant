/**
 * Search Grants API Endpoint for Oracle
 * Usage: GET /search-grants?keywords=hiring&regions=BC&industries=tech&maxResults=10
 */

import { searchGrants, getGrantById, getGrantStats } from './scripts/create-search-function.js';

export async function searchGrantsEndpoint(req, res) {
  try {
    const {
      keywords,
      regions,
      industries,
      grantTypes,
      includeInactive,
      maxResults,
      grantId,
      stats
    } = req.query;

    // If requesting stats
    if (stats === 'true') {
      console.log('📊 Getting grant statistics...');
      const statistics = await getGrantStats();
      return res.json(statistics);
    }

    // If requesting specific grant by ID
    if (grantId) {
      console.log(`🔍 Getting grant by ID: ${grantId}`);
      const grant = await getGrantById(grantId);
      if (!grant) {
        return res.status(404).json({ error: 'Grant not found' });
      }
      return res.json(grant);
    }

    // Parse array parameters (comma-separated)
    const keywordsArray = keywords ? keywords.split(',').map(k => k.trim()) : [];
    const regionsArray = regions ? regions.split(',').map(r => r.trim()) : [];
    const industriesArray = industries ? industries.split(',').map(i => i.trim()) : [];
    const grantTypesArray = grantTypes ? grantTypes.split(',').map(t => t.trim()) : [];

    console.log('🔍 Searching grants:', {
      keywords: keywordsArray,
      regions: regionsArray,
      industries: industriesArray,
      grantTypes: grantTypesArray,
      includeInactive: includeInactive === 'true',
      maxResults: parseInt(maxResults) || 50
    });

    // Execute search
    const results = await searchGrants({
      keywords: keywordsArray,
      regions: regionsArray,
      industries: industriesArray,
      grantTypes: grantTypesArray,
      includeInactive: includeInactive === 'true',
      maxResults: parseInt(maxResults) || 50
    });

    console.log(`   ✅ Found ${results.total} grants`);

    return res.json(results);

  } catch (error) {
    console.error('❌ Search endpoint error:', error);
    return res.status(500).json({
      error: 'Search failed',
      message: error.message
    });
  }
}
