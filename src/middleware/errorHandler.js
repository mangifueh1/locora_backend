const AppResponse = require('../utils/AppResponse');

const errorHandler = (err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  if (err instanceof AppResponse) {
    const payload = { error: err.message };
    if (process.env.NODE_ENV !== 'production' && err.details) {
      payload.details = err.details;
    }
    return res.status(err.statusCode).json(payload);
  }

  console.error(err);

  const message = err && err.message ? err.message : 'Internal server error';
  return res.status(err && err.statusCode ? err.statusCode : 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : message
  });
};

module.exports = errorHandler;
