function getPublicAppUrl() {
  return process.env.NODE_ENV === 'development'
    ? 'http://localhost:55990'
    : 'https://www.locora.site';
}

module.exports = { getPublicAppUrl };