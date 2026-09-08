const {parsePhoneNumberWithError} = require('libphonenumber-js');

const DEFAULT_COUNTRY = 'CM';

function normalizePhone(raw) {
    if (!raw) return null;
    try {
        const parsed = parsePhoneNumberWithError(raw, DEFAULT_COUNTRY);
        if (!parsed.isValid()) return null;
        return parsed.number;
    } catch {
        return null;
    }
}

module.exports = {normalizePhone};
