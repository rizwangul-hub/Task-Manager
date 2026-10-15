/**
 * 404 handler for unknown API routes
 */
export const notFoundHandler = (req, res, next) => {
  res.status(404).json({
    status: 'error',
    statusCode: 404,
    message: `Cannot ${req.method} ${req.originalUrl}. Route not found.`
  });
};
