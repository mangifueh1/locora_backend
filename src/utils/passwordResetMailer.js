const sendgrid = require('@sendgrid/mail');

function createPasswordResetMailer() {
  const { SENDGRID_API_KEY, MAIL_FROM } = process.env;
  const missingConfig = ['SENDGRID_API_KEY', 'MAIL_FROM']
    .filter((key) => !process.env[key]);
  if (missingConfig.length) {
    throw new Error(`Password reset email is missing configuration: ${missingConfig.join(', ')}`);
  }

  sendgrid.setApiKey(SENDGRID_API_KEY);

  return (email, resetUrl) => sendgrid.send({
    from: MAIL_FROM,
    to: email,
    subject: 'Reset your Locora business password',
    text: `Use this link to reset your password. It expires in 30 minutes: ${resetUrl}`
  });
}

module.exports = { createPasswordResetMailer };