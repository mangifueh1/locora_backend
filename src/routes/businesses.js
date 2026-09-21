const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const pool = require('../db/pool');
const { signToken } = require('../utils/tokens');
const businessSessionAuth = require('../middleware/businessSessionAuth');

const router = express.Router();

// Registration now sets BOTH a dashboard password and issues an API key.
// name is unique — it doubles as the login identifier.
router.post('/register', async (req, res) => {
  const { name, password, webhook_url } = req.body;
  if (!name || !password) {
    return res.status(400).json({ error: 'name and password are required' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const rawKey = crypto.randomBytes(24).toString('hex');
  const apiKeyHash = await bcrypt.hash(rawKey, 10);

  try {
    const { rows } = await pool.query(
      `INSERT INTO businesses (name, password_hash, api_key_hash, webhook_url)
       VALUES ($1, $2, $3, $4) RETURNING id, name, created_at`,
      [name, passwordHash, apiKeyHash, webhook_url || null]
    );
    const business = rows[0];

    // Show the raw key ONCE — it's not recoverable after this response.
    res.status(201).json({
      business,
      api_key: `${business.id}.${rawKey}`,
      note: 'Store this API key now — it cannot be retrieved again. Use your name + password separately to log into the dashboard.'
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A business with this name already exists' });
    }
    throw err;
  }
});

// Dashboard login — separate credential from the API key entirely.
router.post('/login', async (req, res) => {
  const { name, password } = req.body;
  if (!name || !password) return res.status(400).json({ error: 'name and password are required' });

  const { rows } = await pool.query('SELECT * FROM businesses WHERE name = $1', [name]);
  const business = rows[0];
  if (!business) return res.status(401).json({ error: 'Invalid name or password' });

  const valid = await bcrypt.compare(password, business.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid name or password' });

  const token = signToken({ businessId: business.id, type: 'business' }, '7d');
  res.json({ business: { id: business.id, name: business.name }, token });
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
router.delete('/me/drivers/:driverId', businessSessionAuth, async (req, res) => {
  const { rows } = await pool.query(
    `DELETE FROM driver_businesses WHERE business_id = $1 AND driver_id = $2 RETURNING driver_id`,
    [req.business.id, req.params.driverId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'That driver is not registered with your business' });
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