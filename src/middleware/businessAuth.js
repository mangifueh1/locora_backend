
const bcrypt = require('bcrypt');
const pool = require('../db/pool');

async function businessAuth(req, res, next) {

    const header = req.headers.authorization || '';
    const token = header.replace('Bearer ', '');
    const [businessId, rawKey] = token.split('.');

    if (!businessId || !rawKey) {
        return res.status(401).json({error: 'Missing or malformed Authorization.'});
    }

    const { rows } = await pool.query('SELECT * FROM businesses WHERE id = $1', [businessId]);
    const business = rows[0];
    if (!business) {
        return res.status(401).json({error: 'Unknown Business'});
    }

    const valid = await bcrypt.compare(rawKey, business.api_key_hash);
    if (!valid) return res.status(401).json({error: 'Invalid API key'})
    
    req.business = business;
    next();
}

module.exports = businessAuth;
