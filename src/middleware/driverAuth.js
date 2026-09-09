
const {verifyToken} = require('../utils/tokens');
const pool = require('../db/pool');

async function driverAuth(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload || payload.type !== 'driver') {
        return res.status(401).json({error: "Invalid or expired driver session"});
    }

    const {rows} = await pool.query('SELECT id, name, phone FROM drivers WHERE id = $1', [payload.driverId]);
    if (!rows[0]) return res.status(401).json({error: "Driver not found"});

    req.driver = rows[0];
    next();

}

module.exports = driverAuth;

