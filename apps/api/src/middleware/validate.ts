import type { Request, Response, NextFunction } from 'express';
import type { ZodSchema } from 'zod';

type Source = 'body' | 'query' | 'params';

export function validate<T>(schema: ZodSchema<T>, source: Source = 'body') {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      res.status(400).json({
        error: 'validation_error',
        message: 'Invalid request payload',
        details: result.error.flatten(),
      });
      return;
    }
    // Mutate the request with the parsed/coerced values.
    (req as unknown as Record<Source, unknown>)[source] = result.data;
    next();
  };
}
