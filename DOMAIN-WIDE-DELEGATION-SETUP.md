# Domain-Wide Delegation Setup for Google Drive

This guide enables your Service Account to access all Google Drive files in your organization without manual sharing.

## Prerequisites
- Google Workspace account (not personal Gmail)
- Admin access to Google Workspace Admin Console
- Service Account already created in Google Cloud

---

## Part 1: Enable Domain-Wide Delegation in Google Cloud

### Step 1: Open Google Cloud Console
1. Go to: https://console.cloud.google.com/
2. Select your project (the one with your Service Account)

### Step 2: Navigate to Service Accounts
1. Click hamburger menu (☰) → **IAM & Admin** → **Service Accounts**
2. Find your service account (the one used in `GOOGLE_SERVICE_ACCOUNT_KEY`)
3. Click on the service account email

### Step 3: Enable Domain-Wide Delegation
1. Click the **"Advanced Settings"** or **"Show Domain-Wide Delegation"** section
2. Check the box: **"Enable Google Workspace Domain-wide Delegation"**
3. Click **"Save"**

### Step 4: Note the Client ID
- Copy the **"OAuth 2.0 Client ID"** (it's a long number)
- You'll need this for the next part

**Example:**
```
Client ID: 123456789012345678901
```

---

## Part 2: Authorize in Google Workspace Admin Console

### Step 1: Open Admin Console
1. Go to: https://admin.google.com/
2. Sign in with your Google Workspace admin account

### Step 2: Navigate to API Controls
1. Click **Security** (in the left sidebar)
   - If you don't see Security, click "Show more"
2. Click **Access and data control**
3. Click **API Controls**

### Step 3: Manage Domain-Wide Delegation
1. Scroll down to **"Domain-wide delegation"**
2. Click **"Manage Domain-Wide Delegation"**
3. Click **"Add new"**

### Step 4: Add Service Account Authorization
1. **Client ID**: Paste the OAuth 2.0 Client ID from Part 1, Step 4
2. **OAuth Scopes**: Paste these scopes (comma-separated):
   ```
   https://www.googleapis.com/auth/drive.readonly,https://www.googleapis.com/auth/documents.readonly
   ```
3. Click **"Authorize"**

**Important:** Make sure there are NO SPACES in the scopes list, only commas.

---

## Part 3: Update Your Code

After completing the above steps, the code needs to be updated to use domain-wide delegation.

You'll need to specify which user to "impersonate" when accessing files. Options:
1. **Use a specific admin/service user email** (e.g., `service@granted.ca`)
2. **Dynamically use the logged-in user's email** (from Google OAuth)

---

## Verification

To verify it's working:

1. Complete Part 1 and Part 2 above
2. Wait 10-15 minutes for Google to propagate the changes
3. Update the code to use domain-wide delegation (see Part 3)
4. Test by asking the agent to read any Google Doc in your organization

---

## Troubleshooting

### "unauthorized_client" error
- Wait 10-15 minutes after authorizing in Admin Console
- Verify the Client ID matches exactly
- Check that scopes are comma-separated with no spaces

### "Not Authorized to access this resource/api"
- Make sure the user email you're impersonating exists in your organization
- Verify the scopes include both drive.readonly and documents.readonly

### "Domain-wide delegation not enabled"
- Go back to Part 1 and ensure the checkbox is enabled
- Make sure you clicked "Save"

---

## Security Notes

- Domain-wide delegation is powerful - it allows access to ALL organization files
- Only grant this to trusted Service Accounts
- Use read-only scopes (`readonly`) to prevent accidental modifications
- Consider creating a dedicated admin user for the Service Account to impersonate
- Regularly audit Service Account usage in Admin Console

---

## Alternative: OAuth with Admin Account

If you don't have Workspace Admin access, you can:
1. Use OAuth with an admin/service user account that has access to all files
2. Re-generate the refresh token using that account
3. This is less secure but doesn't require Admin Console access

---

*Last Updated: October 23, 2025*
