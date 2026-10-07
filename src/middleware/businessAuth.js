
const bcrypt = require('bcrypt');
const pool = require('../db/pool');
const AppResponse = require('../utils/AppResponse');

async function businessAuth(req, res, next) {

    const header = req.headers.authorization || '';
    const token = header.replace('Bearer ', '');
    const [businessId, rawKey] = token.split('.');

    if (!businessId || !rawKey) {
        return next(new AppResponse('Missing or malformed Authorization.', 401));
    }

    const { rows } = await pool.query('SELECT * FROM businesses WHERE id = $1', [businessId]);
    const business = rows[0];
    if (!business) {
        return next(new AppResponse('Unknown Business', 401));
    }

    const valid = await bcrypt.compare(rawKey, business.api_key_hash);
    if (!valid) return next(new AppResponse('Invalid API key', 401));
    
    req.business = business;
    next();
}

module.exports = businessAuth;
