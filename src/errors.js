const { ZodError } = require('zod');

class AppError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const badRequest = (msg, details) => new AppError(400, msg, details);
const unauthorized = (msg = 'Authentication required') => new AppError(401, msg);
const forbidden = (msg = 'You do not have permission to do that') => new AppError(403, msg);
const notFound = (msg = 'Not found') => new AppError(404, msg);
const conflict = (msg) => new AppError(409, msg);

// Validate `data` against a zod schema and return the parsed value or throw a 400.
function parse(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw badRequest(
      'Validation failed',
      result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }))
    );
  }
  return result.data;
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.message, ...(err.details && { details: err.details }) });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'Validation failed' });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body is not valid JSON' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body too large' });
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
}

module.exports = { AppError, badRequest, unauthorized, forbidden, notFound, conflict, parse, errorHandler };
