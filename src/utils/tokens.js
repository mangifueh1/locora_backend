
const jwt = require('jsonwebtoken');

function signToken(payload, expiresIn = '30m') {
    return jwt.sign(payload, process.env.JWT_SECRET, {expiresIn});
}

function verifyToken(token) {
    try {
        return jwt.verify(token, process.env.JWT_SECRET);
    } catch {
        return null;
    }
}

module.exports = {signToken, verifyToken};
