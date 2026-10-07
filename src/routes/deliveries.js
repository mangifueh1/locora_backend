const express = require('express');
const pool = require('../db/pool');
const businessAuth = require('../middleware/businessAuth');
const driverAuth = require('../middleware/driverAuth');
const AppResponse = require('../utils/AppResponse');
const { normalizePhone } = require('../utils/phone');
const { signToken, verifyToken } = require('../utils/tokens');

const router = express.Router();
const publicAppUrl = () => process.env.PUBLIC_APP_URL || 'http://localhost:55990';

function validCoordinates(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

// Business kicks off a delivery. Looks up the customer GLOBALLY by phone —
// if any business has ever saved this phone's location, it's reused here too.
router.post('/', businessAuth, async (req, res, next) => {
  const { order_id, customer_phone, customer_uid } = req.body;
  if (!order_id || !customer_phone) {
    return next(new AppResponse('order_id and customer_phone are required', 400));
  }

  const normalizedPhone = normalizePhone(customer_phone);
  if (!normalizedPhone) return next(new AppResponse('Invalid customer_phone', 400));

  let { rows: customerRows } = await pool.query(
    'SELECT * FROM customers WHERE phone = $1', [normalizedPhone]
  );
  let customer = customerRows[0];

  if (!customer) {
    const { rows } = await pool.query(
      'INSERT INTO customers (phone) VALUES ($1) RETURNING *',
      [normalizedPhone]
    );
    customer = rows[0];
  }

  // Record/refresh this business's own bookkeeping reference, if given.
  await pool.query(
    `INSERT INTO business_customers (business_id, customer_id, customer_uid)
     VALUES ($1, $2, $3)
     ON CONFLICT (business_id, customer_id) DO UPDATE SET customer_uid = EXCLUDED.customer_uid`,
    [req.business.id, customer.id, customer_uid || null]
  );

  const hasSavedLocation = customer.lat !== null && customer.lng !== null;

  if (hasSavedLocation) {
    const { rows } = await pool.query(
      `INSERT INTO deliveries (business_id, order_id, customer_id, customer_lat, customer_lng, status)
       VALUES ($1, $2, $3, $4, $5, 'pending') RETURNING id`,
      [req.business.id, order_id, customer.id, customer.lat, customer.lng]
    );
    const trackingToken = signToken({ deliveryId: rows[0].id, type: 'tracking' }, '7d');
    return res.status(201).json({
      requires_location: false,
      delivery_id: rows[0].id,
      tracking_link: `${publicAppUrl()}/track/${trackingToken}`
    });
  }

  // No saved location yet — create the delivery, hand back a picker link.
  const { rows } = await pool.query(
    `INSERT INTO deliveries (business_id, order_id, customer_id, status)
     VALUES ($1, $2, $3, 'pending') RETURNING id`,
    [req.business.id, order_id, customer.id]
  );
  const deliveryId = rows[0].id;
  const pickerToken = signToken({ deliveryId, type: 'picker' }, '30m');
  const trackingToken = signToken({ deliveryId, type: 'tracking' }, '7d');
  await pool.query('UPDATE deliveries SET picker_token = $1 WHERE id = $2', [pickerToken, deliveryId]);

  res.status(201).json({
    requires_location: true,
    delivery_id: deliveryId,
    picker_url: `${publicAppUrl()}/pick/${pickerToken}`,
    tracking_link: `${publicAppUrl()}/track/${trackingToken}`
  });
});

// Customer confirms their pin on the picker screen (called by the Flutter web picker page).
router.post('/by-token/:token/location', async (req, res, next) => {
  const payload = verifyToken(req.params.token);
  if (!payload || payload.type !== 'picker') {
    return next(new AppResponse('Invalid or expired picker link', 401));
  }
  const { lat, lng } = req.body;
  if (!validCoordinates(lat, lng)) {
    return next(new AppResponse('lat and lng must be valid coordinates', 400));
  }

  const { rows } = await pool.query('SELECT * FROM deliveries WHERE id = $1', [payload.deliveryId]);
  const delivery = rows[0];
  if (!delivery) return next(new AppResponse('Delivery not found', 404));

  // Snapshot on the delivery itself...
  await pool.query(
    'UPDATE deliveries SET customer_lat = $1, customer_lng = $2, updated_at = now() WHERE id = $3',
    [lat, lng, delivery.id]
  );
  // ...and write back to the GLOBAL customer profile so every business benefits next time.
  await pool.query(
    'UPDATE customers SET lat = $1, lng = $2, updated_at = now() WHERE id = $3',
    [lat, lng, delivery.customer_id]
  );

  const trackingToken = signToken({ deliveryId: delivery.id, type: 'tracking' }, '7d');
  res.json({
    status: 'success',
    tracking_link: `${publicAppUrl()}/track/${trackingToken}`
  });
});

// Public tracking data for the customer tracking page.
router.get('/by-token/:token', async (req, res, next) => {
  const payload = verifyToken(req.params.token);
  if (!payload || payload.type !== 'tracking') {
    return next(new AppResponse('Invalid or expired tracking link', 401));
  }

  const { rows } = await pool.query(
    `SELECT d.id, d.order_id, d.status, d.customer_lat, d.customer_lng,
            d.driver_id, d.driver_lat, d.driver_lng, d.updated_at,
            b.name AS business_name
     FROM deliveries d
     JOIN businesses b ON b.id = d.business_id
     WHERE d.id = $1`,
    [payload.deliveryId]
  );
  const delivery = rows[0];
  if (!delivery) return next(new AppResponse('Delivery not found', 404));

  res.json({
    delivery: {
      ...delivery,
      driver: delivery.driver_id
        ? { id: delivery.driver_id, lat: delivery.driver_lat, lng: delivery.driver_lng }
        : null,
      assignment: delivery.driver_id ? 'assigned' : 'still_to_be_assigned'
    }
  });
});

// Drivers can claim only deliveries for businesses they belong to, with two active deliveries max.
router.post('/:id/claim', driverAuth, async (req, res, next) => {
  const { lat, lng } = req.body;
  if (!validCoordinates(lat, lng)) {
    return next(new AppResponse('lat and lng must be valid coordinates', 400));
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: driverRows } = await client.query(
      'SELECT id FROM drivers WHERE id = $1 FOR UPDATE',
      [req.driver.id]
    );
    if (!driverRows[0]) {
      await client.query('ROLLBACK');
      return next(new AppResponse('Driver not found', 401));
    }

    const { rows: deliveryRows } = await client.query(
      `SELECT d.*
       FROM deliveries d
       JOIN driver_businesses db ON db.business_id = d.business_id
       WHERE d.id = $1 AND db.driver_id = $2
       FOR UPDATE OF d`,
      [req.params.id, req.driver.id]
    );
    const delivery = deliveryRows[0];
    if (!delivery) {
      await client.query('ROLLBACK');
      return next(new AppResponse('Delivery not found for one of your businesses', 404));
    }
    if (delivery.status !== 'pending' || delivery.driver_id) {
      await client.query('ROLLBACK');
      return next(new AppResponse('Delivery is no longer available', 409));
    }

    const { rows: activeRows } = await client.query(
      `SELECT COUNT(*)::int AS count FROM deliveries
       WHERE driver_id = $1 AND status IN ('assigned', 'in_progress')`,
      [req.driver.id]
    );
    if (activeRows[0].count >= 2) {
      await client.query('ROLLBACK');
      return next(new AppResponse('You can have at most 2 active deliveries', 409));
    }

    const { rows } = await client.query(
      `UPDATE deliveries
       SET driver_id = $1, driver_lat = $2, driver_lng = $3,
           status = 'assigned', updated_at = now()
       WHERE id = $4
       RETURNING *`,
      [req.driver.id, lat, lng, req.params.id]
    );
    await client.query('COMMIT');
    res.status(200).json({ delivery: rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    return next(err);
  } finally {
    client.release();
  }
});

router.post('/:id/location', driverAuth, async (req, res, next) => {
  const { lat, lng } = req.body;
  if (!validCoordinates(lat, lng)) {
    return next(new AppResponse('lat and lng must be valid coordinates', 400));
  }
  const { rows } = await pool.query(
    `UPDATE deliveries SET driver_lat = $1, driver_lng = $2, updated_at = now()
     WHERE id = $3 AND driver_id = $4 RETURNING *`,
    [lat, lng, req.params.id, req.driver.id]
  );
  if (!rows[0]) return next(new AppResponse('Delivery not found or not assigned to you', 404));
  res.json({ delivery: rows[0] });
});

// Driver's own delivery-detail view (used by the tracking/detail screen).
router.get('/:id', driverAuth, async (req, res, next) => {
  const { rows } = await pool.query(
    `SELECT * FROM deliveries WHERE id = $1 AND driver_id = $2`,
    [req.params.id, req.driver.id]
  );
  if (!rows[0]) return next(new AppResponse('Delivery not found or not assigned to you', 404));
  res.json({ delivery: rows[0] });
});

// Driver marks a delivery as in progress (they've picked it up and are en route).
router.post('/:id/start', driverAuth, async (req, res, next) => {
  const { rows } = await pool.query(
    `UPDATE deliveries SET status = 'in_progress', updated_at = now()
     WHERE id = $1 AND driver_id = $2 RETURNING *`,
    [req.params.id, req.driver.id]
  );
  if (!rows[0]) return next(new AppResponse('Delivery not found or not assigned to you', 404));
  res.json({ delivery: rows[0] });
});

// Driver marks a delivery complete.
router.post('/:id/complete', driverAuth, async (req, res, next) => {
  const { rows } = await pool.query(
    `UPDATE deliveries SET status = 'delivered', updated_at = now()
     WHERE id = $1 AND driver_id = $2 RETURNING *`,
    [req.params.id, req.driver.id]
  );
  if (!rows[0]) return next(new AppResponse('Delivery not found or not assigned to you', 404));

  // Optional: fire the business's webhook here so their backend knows too.
  // (left as a TODO — see the "webhook as source of truth" note from the original design.)

  res.json({ delivery: rows[0] });
});

module.exports = router;