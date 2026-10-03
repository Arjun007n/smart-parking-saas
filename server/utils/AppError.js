// An error with an HTTP status that is safe to show to the API client.
class AppError extends Error {
  constructor(message, statusCode = 500, errors) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    if (errors) this.errors = errors;
  }
}

module.exports = AppError;
