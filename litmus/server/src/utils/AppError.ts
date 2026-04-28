export class AppError extends Error {
  constructor(
    public readonly message: string,
    public readonly code: string,
    public readonly statusCode: number,
    public readonly details?: Record<string, string[]>
  ) {
    super(message);
    this.name = 'AppError';
    Object.setPrototypeOf(this, AppError.prototype);
  }

  static badRequest(message: string, details?: Record<string, string[]>) {
    return new AppError(message, 'VALIDATION_ERROR', 400, details);
  }

  static unauthorized(message = 'Authentication required') {
    return new AppError(message, 'UNAUTHORIZED', 401);
  }

  static forbidden(message = 'Insufficient permissions') {
    return new AppError(message, 'FORBIDDEN', 403);
  }

  static notFound(message = 'Resource not found') {
    return new AppError(message, 'NOT_FOUND', 404);
  }

  static conflict(message: string) {
    return new AppError(message, 'CONFLICT', 409);
  }

  static internal(message = 'Something went wrong. Try again.') {
    return new AppError(message, 'SERVER_ERROR', 500);
  }
}
