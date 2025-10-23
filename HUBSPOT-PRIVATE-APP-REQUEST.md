# HubSpot Private App Setup Request

## What Is This For?

We're building an AI-powered assistant that helps our team with grant writing and client management. To make it smarter, we want to connect it to our HubSpot CRM so it can:

- Look up client contact information when asked
- Find company details
- Check deal history

**Think of it like:** Giving our AI assistant a read-only view into HubSpot, similar to how you'd give a new team member "view only" access to see client data.

---

## What Is a "Private App"?

A **private app** is HubSpot's way of letting external tools (like our AI assistant) securely access data from your HubSpot account.

**Simple analogy:**
- It's like creating a special "view-only" login credential for our AI system
- Instead of username/password, it uses a secure token (a long string of letters and numbers)
- You control exactly what it can see and do

---

## Is This Safe?

✅ **Yes! Here's why:**

1. **Read-only access**: We're only requesting permission to VIEW data, not change anything
2. **Limited scope**: It can only access contacts, companies, and deals - nothing else
3. **You control it**: As a super admin, you can delete this app anytime, instantly cutting off access
4. **No human login**: This isn't a user account - it's just an API connection
5. **Industry standard**: This is how professional software integrates with HubSpot

**What it CANNOT do:**
- ❌ Change or delete contacts
- ❌ Send emails
- ❌ Modify deals or pipelines
- ❌ Access billing information
- ❌ Change account settings
- ❌ Access anything beyond the specific permissions granted

---

## Step-by-Step Setup Instructions

**Time needed:** 5 minutes

### Step 1: Access Private Apps

1. Log into HubSpot
2. Click the **Settings** icon (⚙️ gear) in the top navigation bar
3. In the left sidebar, look for **"Integrations"** section
4. Under "Integrations", click **"Private Apps"**
   - If you don't see "Private Apps", try navigating to **"Development" → "Legacy apps"**

---

### Step 2: Create New Private App

1. Click the **"Create private app"** button (usually top right)
2. A setup wizard will appear

---

### Step 3: Basic Information Tab

Fill in these details:

**App Name:**
```
Granted AI Hub - Read Access
```

**Description:**
```
Read-only access for AI agents to query CRM data for grant writing assistance
```

**Logo:** (Optional - you can skip this)

Click **"Next"** or go to the **"Scopes"** tab

---

### Step 4: Configure Scopes (Permissions)

This is where you choose what the app can access. We need **READ-ONLY** permissions for:

**Click "Add new scope" and search for each of these:**

1. ✅ **crm.objects.contacts.read**
   - Description: "Read contacts"
   - This lets the AI look up client contact information

2. ✅ **crm.objects.companies.read**
   - Description: "Read companies"
   - This lets the AI see company details

3. ✅ **crm.objects.deals.read**
   - Description: "Read deals"
   - This lets the AI check deal history

4. ✅ **crm.lists.read** (if available)
   - Description: "Read contact lists"
   - This is optional but helpful

**IMPORTANT:**
- Make sure you're selecting the **.read** versions (read-only)
- Do NOT select any **.write** permissions

---

### Step 5: Skip Webhooks (Not Needed)

If you see a "Webhooks" tab, you can skip it - we don't need webhook subscriptions.

---

### Step 6: Create the App

1. Click **"Create app"** in the top right
2. HubSpot will show a confirmation message about the access token
3. Click **"Continue creating"** or **"I understand"**

---

### Step 7: Copy the Access Token

**THIS IS THE MOST IMPORTANT STEP! ⚠️**

1. After creating the app, you'll see the app details page
2. Look for the **"Auth"** tab at the top
3. You'll see a section called **"Access token"**
4. Click **"Show token"** to reveal the token
5. Click **"Copy"** to copy the token to your clipboard

**The token looks something like this:**
```
pat-na1-12345678-abcd-1234-efgh-567890abcdef
```

6. **Send this token to me securely:**
   - Email it to me directly (don't post in shared channels)
   - Or use Slack/Teams direct message
   - Or paste it into a password manager and share the link

**⚠️ IMPORTANT:** You'll only see this token once! If you lose it, you'll need to "rotate" the token to get a new one.

---

### Step 8: Done! 🎉

That's it! Once you send me the access token, I'll:
1. Add it to our application's secure environment variables
2. Test the connection
3. Let you know it's working

The AI assistant will then be able to look up HubSpot data when users ask questions.

---

## What If Something Goes Wrong?

**You have full control.** If you ever want to revoke access:

1. Go back to **Settings → Integrations → Private Apps**
2. Click on "Granted AI Hub - Read Access"
3. Click **"Delete app"** at the bottom
4. The access token instantly stops working

---

## Questions You Might Have

**Q: Will this affect our HubSpot data or other integrations?**
A: No. This is completely separate and only provides read access.

**Q: Will this cost extra?**
A: No. Private apps are included in all HubSpot plans.

**Q: Can other people use this token?**
A: Only if they have the token string. Keep it secure like a password. We'll store it in our secure environment variables (encrypted).

**Q: How do I know it's working?**
A: I'll run tests and confirm with you once it's set up.

**Q: What if I accidentally give the wrong permissions?**
A: You can edit the app after creating it to add or remove scopes.

**Q: Who will be able to see that this app was created?**
A: Other super admins can see it in the Private Apps list. The app will show your name as the creator.

---

## Thank You!

I appreciate your help with this! It will significantly improve our AI assistant's ability to help the team with personalized grant proposals and client research.

If you have any questions or run into any issues during setup, please let me know!

---

**Contact:** [Your Name]
**Project:** Granted AI Hub - HubSpot Integration
**Date:** October 23, 2025
