const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const pool = require('../db/pool');
const AppResponse = require('../utils/AppResponse');
const { signToken } = require('../utils/tokens');
const { createPasswordResetMailer } = require('../utils/passwordResetMailer');
const { createEmailVerificationMailer } = require('../utils/emailVerificationMailer');
const { getPublicAppUrl } = require('../utils/publicAppUrl');
const businessSessionAuth = require('../middleware/businessSessionAuth');

const router = express.Router();

async function sendEmailVerification(businessId, email) {
  let sendEmailVerificationMessage;
  try {
    sendEmailVerificationMessage = createEmailVerificationMailer();
  } catch (err) {
    console.error('Email verification email failed:', err);
    return false;
  }

  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const { rows } = await pool.query(
    `UPDATE businesses
     SET email_verification_token_hash = $1, email_verification_expires_at = $2
     WHERE id = $3 AND email_verified = FALSE
     RETURNING id`,
    [tokenHash, expiresAt, businessId]
  );
  if (!rows[0]) return false;

  const verificationUrl = new URL('/verify-email', getPublicAppUrl());
  verificationUrl.searchParams.set('token', token);

  try {
    await sendEmailVerificationMessage(email, verificationUrl.toString());
    return true;
  } catch (err) {
    await pool.query(
      `UPDATE businesses
       SET email_verification_token_hash = NULL, email_verification_expires_at = NULL
       WHERE id = $1 AND email_verification_token_hash = $2`,
      [businessId, tokenHash]
    ).catch((cleanupError) => console.error(cleanupError));
    console.error('Email verification email failed:', err);
    return false;
  }
}

// Registration now sets BOTH a dashboard password and issues an API key.
// name is unique — it doubles as the login identifier.
router.post('/register', async (req, res, next) => {
  const { name, email, password, webhook_url } = req.body;
  if (!name || !password) {
    return next(new AppResponse('name and password are required', 400));
  }
  if (typeof email !== 'string' || !email.trim()) {
    return next(new AppResponse('email is required', 400));
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const rawKey = crypto.randomBytes(24).toString('hex');
  const apiKeyHash = await bcrypt.hash(rawKey, 10);

  try {
    const { rows } = await pool.query(
      `INSERT INTO businesses (name, email, password_hash, api_key_hash, webhook_url, email_verified)
       VALUES ($1, $2, $3, $4, $5, FALSE) RETURNING id, name, created_at`,
      [name, email.trim(), passwordHash, apiKeyHash, webhook_url || null]
    );
    const business = rows[0];
    const verificationEmailSent = await sendEmailVerification(business.id, email.trim());

    // Show the raw key ONCE — it's not recoverable after this response.
    res.status(201).json({
      business,
      api_key: `${business.id}.${rawKey}`,
      email_verification_required: true,
      verification_email_sent: verificationEmailSent,
      note: 'Verify your email before using the API key or logging in. Store this API key now — it cannot be retrieved again.'
    });
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'businesses_name_key') {
      return next(new AppResponse('A business with this name already exists', 409));
    }
    if (err.code === '23505' && err.constraint === 'businesses_email_key') {
      return next(new AppResponse('A business with this email already exists', 409));
    }
    return next(err);
  }
});

// Dashboard login — separate credential from the API key entirely.
router.post('/login', async (req, res, next) => {
  const { name, password } = req.body;
  if (!name || !password) return next(new AppResponse('name and password are required', 400));

  const { rows } = await pool.query('SELECT * FROM businesses WHERE name = $1', [name]);
  const business = rows[0];
  if (!business) return next(new AppResponse('Invalid name or password', 401));

  const valid = await bcrypt.compare(password, business.password_hash);
  if (!valid) return next(new AppResponse('Invalid name or password', 401));
  if (!business.email_verified) {
    return next(new AppResponse('Verify your email before logging in', 403));
  }

  const token = signToken({ businessId: business.id, type: 'business' }, '7d');
  res.json({ business: { id: business.id, name: business.name }, token });
});

router.post('/verify-email', async (req, res, next) => {
  const { token } = req.body;
  if (typeof token !== 'string' || !token) {
    return next(new AppResponse('token is required', 400));
  }

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const { rows } = await pool.query(
    `UPDATE businesses
     SET email_verified = TRUE,
         email_verification_token_hash = NULL,
         email_verification_expires_at = NULL
     WHERE email_verification_token_hash = $1
       AND email_verification_expires_at > now()
       AND email_verified = FALSE
     RETURNING id`,
    [tokenHash]
  );
  if (!rows[0]) return next(new AppResponse('Invalid or expired email verification token', 400));

  res.json({ message: 'Email verified. You can now log in and use your API key.' });
});

router.post('/resend-verification', async (req, res, next) => {
  const { email } = req.body;
  if (typeof email !== 'string' || !email.trim()) {
    return next(new AppResponse('email is required', 400));
  }

  const { rows } = await pool.query(
    'SELECT id, email FROM businesses WHERE email = $1 AND email_verified = FALSE',
    [email.trim()]
  );
  if (rows[0]) await sendEmailVerification(rows[0].id, rows[0].email);

  res.json({ message: 'If an unverified account with that email exists, verification instructions have been sent.' });
});

router.post('/forgot-password', async (req, res, next) => {
  const { email } = req.body;
  if (typeof email !== 'string' || !email.trim()) {
    return next(new AppResponse('email is required', 400));
  }

  const sendPasswordResetEmail = createPasswordResetMailer();
  const resetUrl = new URL('/reset-password', getPublicAppUrl());
  const { rows } = await pool.query('SELECT id FROM businesses WHERE email = $1', [email.trim()]);
  const response = { message: 'If an account with that email exists, password reset instructions have been sent.' };
  if (!rows[0]) {
    return res.json(response);
  }

  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
  resetUrl.searchParams.set('token', token);

  await pool.query(
    `UPDATE businesses
     SET password_reset_token_hash = $1, password_reset_expires_at = $2
     WHERE id = $3`,
    [tokenHash, expiresAt, rows[0].id]
  );

  try {
    await sendPasswordResetEmail(email.trim(), resetUrl.toString());
  } catch (err) {
    await pool.query(
      `UPDATE businesses
       SET password_reset_token_hash = NULL, password_reset_expires_at = NULL
       WHERE id = $1 AND password_reset_token_hash = $2`,
      [rows[0].id, tokenHash]
    ).catch((cleanupError) => console.error(cleanupError));
    console.error('Password reset email failed:', err);
    return res.json(response);
  }

  res.json(response);
});

router.post('/reset-password', async (req, res, next) => {
  const { token, password } = req.body;
  if (typeof token !== 'string' || !token || typeof password !== 'string' || !password) {
    return next(new AppResponse('token and password are required', 400));
  }

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const passwordHash = await bcrypt.hash(password, 10);
  const { rows } = await pool.query(
    `UPDATE businesses
     SET password_hash = $1, password_reset_token_hash = NULL, password_reset_expires_at = NULL
     WHERE password_reset_token_hash = $2 AND password_reset_expires_at > now()
     RETURNING id`,
    [passwordHash, tokenHash]
  );
  if (!rows[0]) return next(new AppResponse('Invalid or expired password reset token', 400));

  res.json({ message: 'Password has been reset. You can now log in.' });
});

// --- Dashboard-only routes below, all behind businessSessionAuth ---

// List this business's drivers.
router.get('/me/drivers', businessSessionAuth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT dr.id, dr.name, dr.phone, db.created_at AS joined_at
     FROM driver_businesses db
     JOIN drivers dr ON dr.id = db.driver_id
     WHERE db.business_id = $1
     ORDER BY db.created_at DESC`,
    [req.business.id]
  );
  res.json({ drivers: rows });
});

// Remove a driver from THIS business only — does not delete the driver's account,
// since they may belong to other businesses too. Any of the business's deliveries
// still assigned to them are left as-is; unassign those separately if needed.
router.delete('/me/drivers/:driverId', businessSessionAuth, async (req, res, next) => {
  const { rows } = await pool.query(
    `DELETE FROM driver_businesses WHERE business_id = $1 AND driver_id = $2 RETURNING driver_id`,
    [req.business.id, req.params.driverId]
  );
  if (!rows[0]) return next(new AppResponse('That driver is not registered with your business', 404));
  res.json({ status: 'removed', driver_id: rows[0].driver_id });
});

// List this business's deliveries. Drivers claim pending deliveries themselves.
router.get('/me/deliveries', businessSessionAuth, async (req, res) => {
  const status = req.query.status; // optional: ?status=pending
  const { rows } = await pool.query(
    status
      ? `SELECT * FROM deliveries WHERE business_id = $1 AND status = $2 ORDER BY created_at DESC`
      : `SELECT * FROM deliveries WHERE business_id = $1 ORDER BY created_at DESC`,
    status ? [req.business.id, status] : [req.business.id]
  );
  res.json({ deliveries: rows });
});

// View API key status (never returns the raw key — it's one-time-only, shown at
// creation/regeneration only) and regenerate it on demand.
router.get('/me/api-key', businessSessionAuth, async (req, res) => {
  res.json({ business_id: req.business.id, note: 'The raw API key is never shown again after issuance — regenerate if lost.' });
});

router.post('/me/api-key/regenerate', businessSessionAuth, async (req, res) => {
  const rawKey = crypto.randomBytes(24).toString('hex');
  const apiKeyHash = await bcrypt.hash(rawKey, 10);
  await pool.query('UPDATE businesses SET api_key_hash = $1 WHERE id = $2', [apiKeyHash, req.business.id]);

  res.json({
    api_key: `${req.business.id}.${rawKey}`,
    note: 'The previous API key is now invalid. Store this new one now — it cannot be retrieved again.'
  });
});

module.exports = router;