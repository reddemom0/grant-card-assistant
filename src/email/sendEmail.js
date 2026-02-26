/**
 * Email utility for sending emails via Nodemailer (Gmail SMTP)
 */

import nodemailer from 'nodemailer';

const EMAIL_USER = process.env.EMAIL_USER || 'writers@granted.ca';
const EMAIL_APP_PASSWORD = process.env.EMAIL_APP_PASSWORD;

// Create reusable transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: EMAIL_USER,
    pass: EMAIL_APP_PASSWORD
  }
});

/**
 * Send email via Gmail SMTP
 *
 * @param {Object} options - Email options
 * @param {string} options.to - Recipient email address
 * @param {string} options.toName - Recipient name
 * @param {string} options.subject - Email subject line
 * @param {string} options.htmlBody - HTML email body
 * @returns {Promise<Object>} Send result
 */
export async function sendEmail({ to, toName, subject, htmlBody }) {
  console.log(`📧 sendEmail called for recipient: ${to}`);
  console.log(`📧 Email config — USER: ${EMAIL_USER}, PASSWORD_SET: ${!!EMAIL_APP_PASSWORD}`);

  if (!EMAIL_APP_PASSWORD) {
    const error = 'EMAIL_APP_PASSWORD environment variable not configured';
    console.error(`❌ ${error}`);
    throw new Error(error);
  }

  const mailOptions = {
    from: `"Granted Consulting" <${EMAIL_USER}>`,
    replyTo: 'marketing@granted.ca',
    to: to,
    subject: subject,
    html: htmlBody
  };

  console.log(`📧 Sending email to ${to} with subject: "${subject}"`);
  console.log(`📧 Mail options:`, JSON.stringify({ from: mailOptions.from, to: mailOptions.to, replyTo: mailOptions.replyTo, subject: mailOptions.subject, htmlLength: mailOptions.html.length }));

  try {
    console.log('📧 About to call transporter.sendMail()...');
    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ transporter.sendMail() succeeded — Message ID: ${info.messageId}`);
    console.log(`✅ Email sent successfully to ${to} — Message ID: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error(`❌ transporter.sendMail() failed:`, err.message);
    console.error(`❌ Error code: ${err.code}, command: ${err.command}, responseCode: ${err.responseCode}`);
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
