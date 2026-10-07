const express = require('express');
const pool = require('../db/pool');
const businessAuth = require('../middleware/businessAuth');
const AppResponse = require('../utils/AppResponse');
const { normalizePhone } = require('../utils/phone');

const router = express.Router();

// Any business can trigger a reset for a phone number it has interacted with,
// since the address book is shared platform-wide. If you want to restrict this
// to "only businesses this customer has ordered from," add a check against
// business_customers here before the UPDATE.
router.delete('/:phone/location', businessAuth, async (req, res, next) => {
  const normalizedPhone = normalizePhone(req.params.phone);
  if (!normalizedPhone) return next(new AppResponse('Invalid phone number', 400));

  const { rows } = await pool.query(
    `UPDATE customers SET lat = NULL, lng = NULL, updated_at = now()
     WHERE phone = $1 RETURNING id`,
    [normalizedPhone]
  );
  if (!rows[0]) return next(new AppResponse('No customer found with that phone number', 404));

  res.json({ status: 'reset', customer_id: rows[0].id });
});

module.exports = router;