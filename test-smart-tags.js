/**
 * Test if search endpoint returns smart_tags
 */

const url = 'https://grant-card-assistant-production.up.railway.app/search-grants?grantTypes=Hiring&regions=British%20Columbia&maxResults=1';

fetch(url)
  .then(res => res.json())
  .then(data => {
    console.log('✅ Search completed');
    console.log('Total grants:', data.grants?.length || 0);

    if (data.grants && data.grants.length > 0) {
      const grant = data.grants[0];
      console.log('\nFirst grant:');
      console.log('  grant_name:', grant.grant_name);
      console.log('  has smart_tags:', grant.smart_tags !== undefined && grant.smart_tags !== null);
      console.log('  smart_tags:', JSON.stringify(grant.smart_tags, null, 2));
    }
  })
  .catch(err => {
    console.error('❌ Error:', err.message);
  });
