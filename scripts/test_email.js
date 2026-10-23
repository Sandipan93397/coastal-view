/**
 * Coastal View Mandarmani - CLI Test Email Tool
 * Tests SMTP credentials, TLS handshake, and sends a test email to the Super Admin.
 * Usage: npm run test-email
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  getSmtpConfig,
  verifySmtpConnection,
  sendMailWithRetry,
  templateTestEmail,
  getISTTimestamp
} = require('../email_service');

const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');

function readDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch (e) {
    return {};
  }
}

async function main() {
  console.log('\n============================================================');
  console.log('       COASTAL VIEW MANDARMANI - SMTP EMAIL TESTER          ');
  console.log('============================================================\n');

  const config = getSmtpConfig();
  console.log('Checking SMTP Configuration:');
  console.log(`  • Host:        ${config.host || '(NOT CONFIGURED)'}`);
  console.log(`  • Port:        ${config.port}`);
  console.log(`  • Protocol:    ${config.secure ? 'SSL/TLS (Port 465)' : 'STARTTLS (Port 587)'}`);
  console.log(`  • User:        ${config.user ? config.user.slice(0, 4) + '••••' : '(NOT CONFIGURED)'}`);
  console.log(`  • Sender:      "${config.mailFromName}" <${config.mailFrom}>`);
  console.log(`  • Daily Limit: ${config.dailyLimit} emails/day\n`);

  if (!config.isConfigured) {
    console.error('❌ CONFIGURATION ERROR: SMTP credentials are not fully set in .env.');
    console.error('Please configure the following in your .env file:');
    console.error('  SMTP_HOST=smtp-relay.brevo.com (or your provider)');
    console.error('  SMTP_PORT=587');
    console.error('  SMTP_USER=your_smtp_login');
    console.error('  SMTP_PASS=your_smtp_key_or_password');
    console.error('  MAIL_FROM=verified_sender@yourdomain.com');
    console.error('  MAIL_FROM_NAME="Coastal View Mandarmani"\n');
    process.exit(1);
  }

  console.log('Testing SMTP server connection and TLS handshake...');
  const connResult = await verifySmtpConnection();
  if (!connResult.connected) {
    console.error(`❌ CONNECTION FAILED: ${connResult.message}`);
    if (connResult.errorCode) {
      console.error(`   Error Code: ${connResult.errorCode}`);
    }
    console.error('\nTroubleshooting tips:');
    console.error('  • Check if your SMTP credentials are valid (e.g. Brevo SMTP master key).');
    console.error('  • Ensure port 587 is not blocked by your hosting firewall.');
    console.error('  • Verify that MAIL_FROM is an approved/verified sender with your email provider.\n');
    process.exit(1);
  }

  console.log(`✅ Handshake successful: ${connResult.message}\n`);

  const recipient = (process.env.ADMIN_EMAIL || '').trim();
  if (!recipient) {
    console.error('❌ Missing ADMIN_EMAIL in .env. Specify ADMIN_EMAIL to receive the test email.\n');
    process.exit(1);
  }

  console.log(`Dispatching test email to Super Admin (${recipient})...`);
  const db = readDB();
  const timeStr = getISTTimestamp();
  const template = templateTestEmail({ recipient, timeStr });

  const sendResult = await sendMailWithRetry({
    db,
    type: 'SMTP Test Email',
    to: recipient,
    subject: template.subject,
    html: template.html,
    text: template.text
  });

  if (sendResult.success) {
    console.log(`✅ TEST EMAIL SENT SUCCESSFULLY!`);
    console.log(`  • Message ID: ${sendResult.messageId || 'Generated'}`);
    console.log(`  • Delivered to: ${recipient}`);
    console.log(`  • Logged in mail audit history (recipient masked in db).\n`);
  } else {
    console.error(`❌ FAILED TO DISPATCH EMAIL: ${sendResult.error}`);
    if (sendResult.errorCode) {
      console.error(`   Error Code: ${sendResult.errorCode}`);
    }
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Unexpected error in test-email:', err);
  process.exit(1);
});
