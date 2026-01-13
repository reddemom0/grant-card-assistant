/**
 * Bulk Add Webhooks to VisualPing Jobs
 *
 * This script authenticates with VisualPing API and adds webhook URLs
 * to all jobs (or filtered jobs) in your account.
 *
 * Usage:
 *   node scripts/add-visualping-webhooks.js
 */

import fetch from 'node-fetch';
import readline from 'readline';

// Configuration
const VISUALPING_EMAIL = process.env.VISUALPING_EMAIL || '';
const VISUALPING_PASSWORD = process.env.VISUALPING_PASSWORD || '';
const WEBHOOK_URL = 'https://grant-card-assistant-production.up.railway.app/api/visualping-webhook';

// Prompt for credentials if not in env
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function prompt(question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

/**
 * Authenticate with VisualPing API
 */
async function authenticate(email, password) {
  console.log('🔐 Authenticating with VisualPing...');

  const response = await fetch('https://api.visualping.io/v2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      method: 'PASSWORD',
      email,
      password
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Authentication failed: ${error}`);
  }

  const data = await response.json();
  console.log('✅ Authenticated successfully');

  return data.id_token;
}

/**
 * Get user info to find workspaceId
 */
async function getUserInfo(idToken) {
  const response = await fetch('https://account.api.visualping.io/describe-user', {
    headers: { 'Authorization': `Bearer ${idToken}` }
  });

  if (!response.ok) {
    throw new Error('Failed to get user info');
  }

  return await response.json();
}

/**
 * List all jobs in workspace (with pagination)
 */
async function listJobs(idToken, workspaceId) {
  console.log(`\n📋 Fetching jobs from workspace ${workspaceId}...`);

  let allJobs = [];
  let pageIndex = 0;
  let totalPages = 1;
  let totalJobs = 0;

  // Fetch all pages
  while (pageIndex < totalPages) {
    const response = await fetch(
      `https://api.visualping.io/v2/jobs?workspaceId=${workspaceId}&pageSize=100&pageIndex=${pageIndex}`,
      {
        headers: { 'Authorization': `Bearer ${idToken}` }
      }
    );

    if (!response.ok) {
      throw new Error('Failed to list jobs');
    }

    const data = await response.json();

    // First page - set totals
    if (pageIndex === 0) {
      totalPages = data.totalPages;
      totalJobs = data.totalJobs;
      console.log(`✅ Found ${totalJobs} total jobs across ${totalPages} pages`);
    }

    allJobs = allJobs.concat(data.jobs || []);
    console.log(`   📄 Loaded page ${pageIndex + 1}/${totalPages} (${allJobs.length}/${totalJobs} jobs)`);

    pageIndex++;

    // Rate limit between pages
    if (pageIndex < totalPages) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  return {
    totalJobs: totalJobs,
    jobs: allJobs
  };
}

/**
 * Get job details
 */
async function getJobDetails(idToken, workspaceId, jobId) {
  const response = await fetch(
    `https://api.visualping.io/v2/jobs/${jobId}?workspaceId=${workspaceId}`,
    {
      headers: { 'Authorization': `Bearer ${idToken}` }
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to get job ${jobId} details`);
  }

  return await response.json();
}

/**
 * Update job with webhook
 */
async function updateJobWebhook(idToken, workspaceId, jobId, jobDetails, webhookUrl) {
  // Prepare notification config with webhook
  const notification = {
    ...jobDetails.notification,
    config: {
      ...(jobDetails.notification?.config || {}),
      webhook: {
        notificationType: "webhook",
        active: true,
        url: webhookUrl
      }
    }
  };

  // Prepare full job update payload
  const updatePayload = {
    workspaceId,
    jobId,
    url: jobDetails.url,
    description: jobDetails.description,
    mode: jobDetails.mode,
    active: jobDetails.active,
    interval: String(jobDetails.interval),
    trigger: String(jobDetails.notification_threshold || 0),
    crop: jobDetails.crop,
    proxy_id: jobDetails.proxy_id,
    prompt_id: jobDetails.prompt_id,
    xpath: jobDetails.xpath,
    keyword_action: jobDetails.keyword_action,
    keywords: jobDetails.keywords,
    disable_js: jobDetails.disable_js,
    enable_cookies_and_ad_blocker: jobDetails.enable_cookies_and_ad_blocker,
    page_height: jobDetails.page_height,
    target_device: jobDetails.target_device,
    wait_time: jobDetails.wait_time,
    preactions: jobDetails.preactions,
    advanced_schedule: jobDetails.advanced_schedule,
    notification: notification,
    retention_policy: jobDetails.retention_policy,
    alert_error: jobDetails.alert_error,
    summalyzer: jobDetails.summalyzer,
    labelIds: jobDetails.labelIds
  };

  const response = await fetch(
    `https://api.visualping.io/v2/jobs/${jobId}`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${idToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(updatePayload)
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to update job ${jobId}: ${error}`);
  }

  return await response.json();
}

/**
 * Filter jobs based on criteria
 */
function filterJobs(jobs, options = {}) {
  const {
    searchTerm = null,
    activeOnly = true
  } = options;

  return jobs.filter(job => {
    // Filter active/inactive
    if (activeOnly && !job.active) {
      return false;
    }

    // Filter by search term in URL or description
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      const url = (job.url || '').toLowerCase();
      const desc = (job.description || '').toLowerCase();

      return url.includes(term) || desc.includes(term);
    }

    return true;
  });
}

/**
 * Main function
 */
async function main() {
  try {
    console.log('═'.repeat(80));
    console.log('🔮 VisualPing Webhook Bulk Add Script');
    console.log('═'.repeat(80));

    // Get credentials
    let email = VISUALPING_EMAIL;
    let password = VISUALPING_PASSWORD;

    if (!email) {
      email = await prompt('VisualPing Email: ');
    }
    if (!password) {
      password = await prompt('VisualPing Password: ');
    }

    // Authenticate
    const idToken = await authenticate(email, password);

    // Get user info and workspace
    const userInfo = await getUserInfo(idToken);
    const workspaceId = userInfo.personalWorkspace?.id ||
                       userInfo.workspaces?.[0]?.id;

    if (!workspaceId) {
      throw new Error('No workspace found');
    }

    console.log(`📂 Using workspace: ${workspaceId}`);

    // List all jobs
    const jobsData = await listJobs(idToken, workspaceId);

    if (jobsData.totalJobs === 0) {
      console.log('❌ No jobs found');
      rl.close();
      return;
    }

    // Ask user for filtering
    console.log('\n❓ Filter jobs?');
    console.log('   1. Add webhook to ALL jobs');
    console.log('   2. Filter by keyword (e.g., only "grant" or "canada.ca")');
    console.log('   3. Active jobs only');

    const filterChoice = await prompt('Choice (1/2/3): ');

    let filteredJobs;
    let searchTerm = null;

    if (filterChoice === '2') {
      searchTerm = await prompt('Enter search term (URL or description): ');
      console.log(`\n🔍 Filtering jobs containing: "${searchTerm}"`);
    }

    // Get full job details for first page
    const jobs = jobsData.jobs || [];

    filteredJobs = filterJobs(jobs, {
      searchTerm,
      activeOnly: filterChoice === '3'
    });

    console.log(`\n✅ Found ${filteredJobs.length} matching jobs`);

    if (filteredJobs.length === 0) {
      console.log('❌ No jobs match your filters');
      rl.close();
      return;
    }

    // Show sample jobs
    console.log('\n📄 Sample jobs:');
    filteredJobs.slice(0, 5).forEach(job => {
      console.log(`   - ${job.url} (${job.description || 'No description'})`);
    });

    if (filteredJobs.length > 5) {
      console.log(`   ... and ${filteredJobs.length - 5} more`);
    }

    // Confirm
    const confirm = await prompt(`\n⚠️  Add webhook to ${filteredJobs.length} jobs? (yes/no): `);

    if (confirm.toLowerCase() !== 'yes') {
      console.log('❌ Cancelled');
      rl.close();
      return;
    }

    // Process jobs
    console.log(`\n🚀 Adding webhooks to ${filteredJobs.length} jobs...`);
    console.log(`   Webhook URL: ${WEBHOOK_URL}`);
    console.log('');

    let successCount = 0;
    let errorCount = 0;
    let skippedCount = 0;

    for (let i = 0; i < filteredJobs.length; i++) {
      const job = filteredJobs[i];
      const jobNumber = i + 1;

      try {
        console.log(`[${jobNumber}/${filteredJobs.length}] Processing: ${job.url.substring(0, 60)}...`);

        // Get full job details
        const jobDetails = await getJobDetails(idToken, workspaceId, job.id);

        // Check if webhook already exists
        if (jobDetails.notification?.config?.webhook?.url === WEBHOOK_URL) {
          console.log(`   ⏭️  Already has webhook, skipping`);
          skippedCount++;
          continue;
        }

        // Update job with webhook
        await updateJobWebhook(idToken, workspaceId, job.id, jobDetails, WEBHOOK_URL);

        console.log(`   ✅ Webhook added`);
        successCount++;

        // Rate limiting: wait 500ms between requests
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
        errorCount++;
      }
    }

    // Summary
    console.log('\n' + '═'.repeat(80));
    console.log('📊 SUMMARY');
    console.log('═'.repeat(80));
    console.log(`✅ Success: ${successCount} jobs`);
    console.log(`⏭️  Skipped: ${skippedCount} jobs (already had webhook)`);
    console.log(`❌ Errors: ${errorCount} jobs`);
    console.log(`📊 Total: ${filteredJobs.length} jobs processed`);
    console.log('');

    if (errorCount > 0) {
      console.log('⚠️  Some jobs failed. Review errors above.');
    } else {
      console.log('🎉 All jobs processed successfully!');
    }

    console.log('\n✅ Done! Your VisualPing jobs will now send alerts to Oracle.\n');

  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    console.error(error.stack);
  } finally {
    rl.close();
  }
}

// Run
main();
