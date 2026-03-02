/**
 * Test Email Endpoint
 *
 * Temporary endpoint to verify Gmail API credentials and email sending functionality.
 * Tests the same Gmail API over HTTPS used in lead-gen finalization.
 *
 * Usage: GET /api/test-email
 *
 * Remove this endpoint once email sending is confirmed working.
 */

import { sendEmail, wrapInBrandedTemplate } from '../src/email/sendEmail.js';

export default async function handler(req, res) {
  console.log('🧪 Test email endpoint called');

  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Create test email content
    const testEmailBody = `
<p>Hi there,</p>

<p>This is a test email from the Granted Consulting lead-gen system.</p>

<p>If you're seeing this, it means:</p>
<ul>
  <li>✅ Gmail API credentials are configured correctly</li>
  <li>✅ Gmail API over HTTPS is working (bypassing Railway SMTP port blocking)</li>
  <li>✅ OAuth2 authentication successful</li>
  <li>✅ Email delivery is functioning</li>
</ul>

<p><strong>Test funding estimate: $40,000 - $60,000</strong></p>

<p>This email was sent from the GET /api/test-email endpoint using Gmail API.</p>

<p>Talk soon,<br>The Granted Team</p>
    `.trim();

    // Wrap in branded template
    const brandedHtml = wrapInBrandedTemplate(testEmailBody);

    console.log('🧪 Sending test email to chris.small011@gmail.com...');

    // Send test email
    const result = await sendEmail({
      to: 'chris.small011@gmail.com',
      toName: 'Christopher Small',
      subject: 'Test Email - Granted Lead-Gen System',
      htmlBody: brandedHtml
    });

    console.log('✅ Test email sent successfully:', result);

    // Return success response
    return res.status(200).json({
      success: true,
      message: 'Test email sent successfully',
      recipient: 'chris.small011@gmail.com',
      messageId: result.messageId,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error('❌ Test email failed:', err);

    // Return detailed error response
    return res.status(500).json({
      success: false,
      error: err.message,
      code: err.code,
      command: err.command,
      responseCode: err.responseCode,
      response: err.response,
      timestamp: new Date().toISOString()
    });
  }
}
