export class ApiError extends Error {
  constructor(
    public readonly status: 400 | 404 | 416 | 502 | 503 | 504,
    public readonly code: string,
    message: string,
    public readonly retryAfter?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
