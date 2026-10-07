
const {verifyToken} = require('../utils/tokens');
const pool = require('../db/pool');
const AppResponse = require('../utils/AppResponse');

async function driverAuth(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload || payload.type !== 'driver') {
        return next(new AppResponse('Invalid or expired driver session', 401));
    }

    const {rows} = await pool.query('SELECT id, name, phone FROM drivers WHERE id = $1', [payload.driverId]);
    if (!rows[0]) return next(new AppResponse('Driver not found', 401));

    req.driver = rows[0];
    next();

}

module.exports = driverAuth;

