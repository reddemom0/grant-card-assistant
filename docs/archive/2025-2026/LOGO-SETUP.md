# Granted Logo Setup for Document Headers

## Overview
The document generation system now supports inserting the Granted Consulting logo in the header of all generated documents (Interview Questions, Readiness Assessments, and Evaluation Rubrics).

## Current Status
✅ Logo file added to project: `public/images/granted-logo.png` (71KB)
✅ Code updated to support logo insertion in `src/tools/google-docs-advanced.js`
⏳ **Pending**: Upload logo to Google Drive and configure URL

## Setup Steps

### Option 1: Upload to Google Drive (Recommended)

1. **Upload the logo to Google Drive**:
   - Go to [Google Drive](https://drive.google.com)
   - Upload `public/images/granted-logo.png`
   - Right-click → Share → Change to "Anyone with the link"
   - Copy the file ID from the shareable link (it's the long string after `/d/` and before `/view`)

2. **Get the direct URL**:
   - If file ID is: `1ABC123xyz`
   - Direct URL is: `https://drive.google.com/uc?export=view&id=1ABC123xyz`

3. **Set environment variable in Railway**:
   ```bash
   GRANTED_LOGO_URL=https://drive.google.com/uc?export=view&id=YOUR_FILE_ID
   ```

4. **Restart the Railway app** to apply the new environment variable

### Option 2: Use Railway-Hosted Logo

After deploying to Railway, the logo will be available at:
```
https://your-app.railway.app/images/granted-logo.png
```

Set the environment variable:
```bash
GRANTED_LOGO_URL=https://your-app.railway.app/images/granted-logo.png
```

Note: Replace `your-app.railway.app` with your actual Railway domain.

### Option 3: Use Automated Upload Script

If you have Google Drive API credentials configured on Railway:

1. Run the upload script:
   ```bash
   node upload-logo.js
   ```

2. Copy the URL output by the script

3. Set the `GRANTED_LOGO_URL` environment variable in Railway

## How It Works

- The `addGrantedHeader()` function in `google-docs-advanced.js` checks if `GRANTED_LOGO_URL` is set
- If set and valid, it inserts the logo image (200pt wide × 40pt tall) right-aligned in the header
- If not set, it falls back to text: "GRANTED CONSULTING"

## Testing

After setting the logo URL:

1. Deploy the app to Railway
2. Create a new document (Readiness Assessment, Interview Questions, or Evaluation Rubric)
3. Verify the logo appears in the top-right corner of the generated Google Doc

## Logo Specifications

- **File**: `granted-logo.png`
- **Size**: 71KB
- **Dimensions in document**: 200pt wide × 40pt tall
- **Alignment**: Right-aligned
- **Format**: PNG with transparency
