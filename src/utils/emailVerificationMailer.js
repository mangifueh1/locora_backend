const sendgrid = require('@sendgrid/mail');

function createEmailVerificationMailer() {
  const { SENDGRID_API_KEY, MAIL_FROM } = process.env;
  const missingConfig = ['SENDGRID_API_KEY', 'MAIL_FROM']
    .filter((key) => !process.env[key]);
  if (missingConfig.length) {
    throw new Error(`Email verification is missing configuration: ${missingConfig.join(', ')}`);
  }

  sendgrid.setApiKey(SENDGRID_API_KEY);

  return (email, verificationUrl) => sendgrid.send({
    from: MAIL_FROM,
    to: email,
    subject: 'Verify your Locora business email',
    text: `Verify your email address to activate your Locora business account. This link expires in 24 hours: ${verificationUrl}`
  });
}

module.exports = { createEmailVerificationMailer };