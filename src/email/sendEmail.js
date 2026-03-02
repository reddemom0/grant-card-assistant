/**
 * Email utility for sending emails via Gmail API over HTTPS
 *
 * Uses Gmail REST API (port 443) instead of SMTP (ports 465/587)
 * because Railway blocks outbound SMTP ports.
 */

import { google } from 'googleapis';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GMAIL_REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN;

// Create OAuth2 client
const oAuth2Client = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  'https://developers.google.com/oauthplayground'
);

oAuth2Client.setCredentials({
  refresh_token: GMAIL_REFRESH_TOKEN
});

/**
 * Send email via Gmail API over HTTPS
 *
 * @param {Object} options - Email options
 * @param {string} options.to - Recipient email address
 * @param {string} options.toName - Recipient name (not used with Gmail API)
 * @param {string} options.subject - Email subject line
 * @param {string} options.htmlBody - HTML email body
 * @returns {Promise<Object>} Send result
 */
export async function sendEmail({ to, toName, subject, htmlBody }) {
  console.log(`📧 sendEmail called for recipient: ${to}`);
  console.log(`📧 Using Gmail API over HTTPS (not SMTP — bypasses Railway port blocking)`);
  console.log(`📧 CLIENT_ID set: ${!!GOOGLE_CLIENT_ID}, SECRET set: ${!!GOOGLE_CLIENT_SECRET}, REFRESH_TOKEN set: ${!!GMAIL_REFRESH_TOKEN}`);

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) {
    const error = 'Gmail API credentials not configured (need GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GMAIL_REFRESH_TOKEN)';
    console.error(`❌ ${error}`);
    throw new Error(error);
  }

  try {
    const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

    // Encode subject as UTF-8 base64 to support special characters
    const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;

    // Build RFC 2822 formatted message
    const messageParts = [
      `From: Granted Consulting <writers@granted.ca>`,
      `To: ${to}`,
      `Reply-To: marketing@granted.ca`,
      `Subject: ${utf8Subject}`,
      `MIME-Version: 1.0`,
      `Content-Type: text/html; charset=utf-8`,
      '',
      htmlBody
    ];
    const message = messageParts.join('\n');

    // Base64url encode the message
    const encodedMessage = Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    console.log(`📧 Sending email to ${to} with subject: "${subject}"`);
    console.log(`📧 Message encoded (${encodedMessage.length} chars base64)`);

    const result = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage
      }
    });

    console.log(`✅ Gmail API send succeeded — Message ID: ${result.data.id}`);
    console.log(`✅ Email sent successfully to ${to} — Message ID: ${result.data.id}`);
    return { success: true, messageId: result.data.id };
  } catch (err) {
    console.error(`❌ Gmail API send FAILED for ${to}:`, err.message);
    if (err.response) {
      console.error(`❌ Gmail API response status: ${err.response.status}`);
      console.error(`❌ Gmail API response data:`, JSON.stringify(err.response.data, null, 2));
    }
    console.error(`❌ Full error:`, err);
    throw err;
  }
}

/**
 * Wrap email content in Granted branded HTML template
 *
 * @param {string} emailBodyContent - Inner HTML content
 * @returns {string} Full branded HTML email
 */
export function wrapInBrandedTemplate(emailBodyContent) {
  return `
<!DOCTYPE html>
<html>
<body style="margin: 0; padding: 0; background-color: #f5f5f5;">
  <div style="max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif; background-color: #ffffff;">
    <div style="text-align: center; padding: 30px 0 20px 0; border-bottom: 2px solid #eeeeee;">
      <img src="https://granted.ca/wp-content/uploads/2021/11/gc-logo-200px.png" alt="Granted Consulting" style="height: 50px;">
    </div>
    <div style="padding: 30px 30px 40px 30px; font-size: 15px; line-height: 1.6; color: #333333;">
      ${emailBodyContent}
    </div>
    <div style="padding: 20px 30px; text-align: center; font-size: 12px; color: #999999; border-top: 2px solid #eeeeee;">
      <p style="margin: 5px 0;">Granted Consulting · <a href="https://granted.ca" style="color: #999999;">granted.ca</a></p>
      <p style="margin: 5px 0;">Helping Canadian businesses secure grant funding since 2012.</p>
    </div>
  </div>
</body>
</html>
  `.trim();
}
