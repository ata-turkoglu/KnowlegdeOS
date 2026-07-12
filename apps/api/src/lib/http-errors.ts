export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}

export function isHttpError(error: unknown): error is HttpError {
  return error instanceof HttpError;
}
