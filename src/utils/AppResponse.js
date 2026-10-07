class AppResponse extends Error {
  constructor(message, statusCode = 500, details = null) {
    super(message);
    this.name = 'AppResponse';
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

module.exports = AppResponse;
