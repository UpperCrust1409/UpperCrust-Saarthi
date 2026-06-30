const { z } = require('zod');
 
// Validates req[source] (default 'body', also usable for 'params'/'query') against
// the given Zod schema. On success, replaces req[source] with the parsed/coerced
// data so downstream handlers see clean, typed values. On failure, returns 400
// with a structured, field-level error list — never throws, never reaches
// business logic with invalid input.
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: result.error.issues.map(i => ({ path: i.path.join('.') || source, message: i.message })),
      });
    }
    req[source] = result.data;
    next();
  };
}
 
module.exports = { validate, z };
