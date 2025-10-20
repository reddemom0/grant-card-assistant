/**
 * Setup Google Drive MCP Credentials for Production
 * Writes credentials from environment variables to temporary files
 * Refreshes access tokens if expired
 */

import fs from 'fs/promises';
import path from 'path';
import { google } from 'googleapis';

/**
 * Setup Google Drive credentials for production
 * In Railway, write credentials from environment variables to /tmp/
 * Locally, use credentials from mcp-servers/gdrive/credentials/
 */
export async function setupGDriveCredentials() {
  const isProduction = process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT;

  if (!isProduction) {
    // Local development - use existing credential files
    console.log('📁 Using local Google Drive credentials');
    return {
      oauthPath: './mcp-servers/gdrive/credentials/gcp-oauth.keys.json',
      credentialsPath: './mcp-servers/gdrive/credentials/.gdrive-server-credentials.json',
    };
  }

  // Production (Railway) - write credentials from environment variables
  console.log('🔐 Setting up Google Drive credentials for production...');

  const oauthJSON = process.env.GOOGLE_DRIVE_OAUTH_JSON;
  const credentialsJSON = process.env.GOOGLE_DRIVE_CREDENTIALS_JSON;

  if (!oauthJSON || !credentialsJSON) {
    console.error('❌ Missing Google Drive environment variables:');
    if (!oauthJSON) console.error('   - GOOGLE_DRIVE_OAUTH_JSON');
    if (!credentialsJSON) console.error('   - GOOGLE_DRIVE_CREDENTIALS_JSON');
    throw new Error('Google Drive credentials not configured in Railway environment variables');
  }

  // Write credentials to /tmp/ (ephemeral, cleared on restart)
  const oauthPath = '/tmp/gcp-oauth.keys.json';
  const credentialsPath = '/tmp/.gdrive-server-credentials.json';

  try {
    // Parse credentials
    const oauthKeys = JSON.parse(oauthJSON);
    const credentials = JSON.parse(credentialsJSON);

    // Extract OAuth client credentials
    const { client_id, client_secret, redirect_uris } = oauthKeys.installed || oauthKeys.web;

    // Check if access token is expired
    const now = Date.now();
    const isExpired = !credentials.expiry_date || credentials.expiry_date < now;

    if (isExpired) {
      console.log('🔄 Access token expired, refreshing...');

      // Initialize OAuth2 client to refresh token
      const oauth2Client = new google.auth.OAuth2(
        client_id,
        client_secret,
        redirect_uris[0]
      );

      // Set existing credentials (including refresh_token)
      oauth2Client.setCredentials(credentials);

      try {
        // Force token refresh
        const { credentials: refreshedCredentials } = await oauth2Client.refreshAccessToken();

        // Update credentials with fresh access token
        credentials.access_token = refreshedCredentials.access_token;
        credentials.expiry_date = refreshedCredentials.expiry_date;
        if (refreshedCredentials.refresh_token) {
          credentials.refresh_token = refreshedCredentials.refresh_token;
        }

        console.log(`✅ Token refreshed successfully (expires: ${new Date(credentials.expiry_date).toISOString()})`);
      } catch (refreshError) {
        console.error('⚠️  Token refresh failed:', refreshError.message);
        console.log('⚠️  Continuing with existing credentials - MCP server will attempt refresh');
      }
    } else {
      const expiresIn = Math.round((credentials.expiry_date - now) / 1000 / 60);
      console.log(`✅ Access token valid (expires in ${expiresIn} minutes)`);
    }

    // Write OAuth credentials
    await fs.writeFile(oauthPath, JSON.stringify(oauthKeys, null, 2), 'utf-8');
    console.log(`✅ OAuth credentials written to: ${oauthPath}`);

    // Write refreshed user credentials
    await fs.writeFile(credentialsPath, JSON.stringify(credentials, null, 2), 'utf-8');
    console.log(`✅ User credentials written to: ${credentialsPath}`);

    // Verify files were written
    const oauthExists = await fs.access(oauthPath).then(() => true).catch(() => false);
    const credExists = await fs.access(credentialsPath).then(() => true).catch(() => false);

    if (!oauthExists || !credExists) {
      throw new Error('Failed to write credential files');
    }

    console.log('✅ Google Drive credentials configured for production');

    return {
      oauthPath,
      credentialsPath,
    };
  } catch (error) {
    console.error('❌ Failed to setup Google Drive credentials:', error.message);
    throw error;
  }
}

/**
 * Get MCP server configuration with correct credential paths
 */
export async function getGDriveMCPConfig() {
  const { oauthPath, credentialsPath } = await setupGDriveCredentials();

  return {
    type: 'stdio',
    command: 'node',
    args: ['./mcp-servers/gdrive/dist/index.js'],
    env: {
      GOOGLE_APPLICATION_CREDENTIALS: oauthPath,
      MCP_GDRIVE_CREDENTIALS: credentialsPath,
    },
  };
}

export default setupGDriveCredentials;
