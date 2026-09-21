const express = require('express');
const bcrypt = require('bcrypt');
const pool = require('../db/pool');
const { normalizePhone } = require('../utils/phone');
const { signToken } = require('../utils/tokens');
const driverAuth = require('../middleware/driverAuth');

const router = express.Router();

// Sign up with name, phone, password, and one or more business_ids.
// No approval step — valid business_ids become active memberships immediately.
router.post('/register', async (req, res) => {
  const { name, phone, password, business_ids } = req.body;

  if (!name || !phone || !password) {
    return res.status(400).json({ error: 'name, phone, and password are required' });
  }
  if (!Array.isArray(business_ids) || business_ids.length === 0) {
    return res.status(400).json({ error: 'business_ids must be a non-empty array' });
  }

  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return res.status(400).json({ error: 'Invalid phone number' });

  // Validate every business_id exists before creating anything.
  const { rows: found } = await pool.query(
    'SELECT id FROM businesses WHERE id = ANY($1::uuid[])',
    [business_ids]
  );
  if (found.length !== business_ids.length) {
    return res.status(400).json({ error: 'One or more business_ids do not exist' });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: driverRows } = await client.query(
      `INSERT INTO drivers (name, phone, password_hash)
       VALUES ($1, $2, $3) RETURNING id, name, phone, created_at`,
      [name, normalizedPhone, passwordHash]
    );
    const driver = driverRows[0];

    for (const businessId of business_ids) {
      await client.query(
        `INSERT INTO driver_businesses (driver_id, business_id) VALUES ($1, $2)`,
        [driver.id, businessId]
      );
    }

    await client.query('COMMIT');

    const token = signToken({ driverId: driver.id, type: 'driver' }, '7d');
    res.status(201).json({ driver, token });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A driver with this phone number already exists' });
    }
    throw err;
  } finally {
    client.release();
  }
});

router.post('/login', async (req, res) => {
  const { phone, password } = req.body;
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone || !password) {
    return res.status(400).json({ error: 'phone and password are required' });
  }

  const { rows } = await pool.query('SELECT * FROM drivers WHERE phone = $1', [normalizedPhone]);
  const driver = rows[0];
  if (!driver) return res.status(401).json({ error: 'Invalid phone or password' });

  const valid = await bcrypt.compare(password, driver.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid phone or password' });

  const token = signToken({ driverId: driver.id, type: 'driver' }, '7d');
  res.json({
    driver: { id: driver.id, name: driver.name, phone: driver.phone },
    token
  });
});

// Deliveries this driver can claim from businesses they belong to.
router.get('/me/available-deliveries', driverAuth, async (req, res) => {
  const { rows: activeRows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM deliveries
     WHERE driver_id = $1 AND status IN ('assigned', 'in_progress')`,
    [req.driver.id]
  );
  const { rows } = await pool.query(
    `SELECT d.id, d.order_id, d.status, d.customer_lat, d.customer_lng,
            b.id AS business_id, b.name AS business_name, d.created_at
     FROM deliveries d
     JOIN driver_businesses db ON db.business_id = d.business_id
     JOIN businesses b ON b.id = d.business_id
     WHERE db.driver_id = $1 AND d.status = 'pending' AND d.driver_id IS NULL
     ORDER BY d.created_at ASC`,
    [req.driver.id]
  );
  res.json({
    active_delivery_count: activeRows[0].count,
    available_slots: Math.max(0, 2 - activeRows[0].count),
    deliveries: rows
  });
});

// The driver's own dashboard feed — everything assigned to them, newest first.
router.get('/me/deliveries', driverAuth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT d.id, d.order_id, d.status, d.customer_lat, d.customer_lng,
            d.driver_lat, d.driver_lng,
            b.name AS business_name, d.created_at
     FROM deliveries d
     JOIN businesses b ON b.id = d.business_id
     WHERE d.driver_id = $1
     ORDER BY d.created_at DESC`,
    [req.driver.id]
  );
  res.json({ deliveries: rows });
});

// Which businesses this driver belongs to.
router.get('/me/businesses', driverAuth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT b.id, b.name FROM driver_businesses db
     JOIN businesses b ON b.id = db.business_id
     WHERE db.driver_id = $1`,
    [req.driver.id]
  );
  res.json({ businesses: rows });
});

module.exports = router;