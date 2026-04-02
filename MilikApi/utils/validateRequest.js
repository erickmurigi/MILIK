import { z } from 'zod';

/**
 * Validation middleware factory
 * @param {z.ZodSchema} schema - Zod schema to validate against
 * @param {string} source - Where to get data from: 'body', 'query', or 'params'
 * @returns Express middleware function
 */
export const validateRequest = (schema, source = 'body') => {
  return (req, res, next) => {
    try {
      const dataToValidate = req[source];
      const validatedData = schema.parse(dataToValidate);
      
      // Replace the source data with validated data
      req[source] = validatedData;
      
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        // Format Zod errors for better readability (Zod v3/v4 compatible)
        const zodIssues = Array.isArray(error.issues)
          ? error.issues
          : Array.isArray(error.errors)
            ? error.errors
            : [];

        const formattedErrors = zodIssues.map(err => ({
          field: err.path.join('.'),
          message: err.message
        }));
        
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: formattedErrors
        });
      }
      
      // Pass other errors to error handler
      next(error);
    }
  };
};

/**
 * Validate multiple sources (body, query, params)
 */
export const validateMultiple = (schemas) => {
  return (req, res, next) => {
    try {
      const errors = [];
      
      // Validate each specified source
      Object.keys(schemas).forEach(source => {
        try {
          const validatedData = schemas[source].parse(req[source]);
          req[source] = validatedData;
        } catch (error) {
          if (error instanceof z.ZodError) {
            const zodIssues = Array.isArray(error.issues)
              ? error.issues
              : Array.isArray(error.errors)
                ? error.errors
                : [];

            zodIssues.forEach(err => {
              errors.push({
                source,
                field: err.path.join('.'),
                message: err.message
              });
            });
          }
        }
      });
      
      if (errors.length > 0) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors
        });
      }
      
      next();
    } catch (error) {
      next(error);
    }
  };
};
