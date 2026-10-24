export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string = "error",
  ) {
    super(message);
  }
}

export const unauthorized = (msg = "Please sign in") => new HttpError(401, msg, "unauthorized");
export const forbidden = (msg = "You do not have access to this data") => new HttpError(403, msg, "forbidden");
export const badRequest = (msg: string) => new HttpError(400, msg, "bad_request");
export const tooManyRequests = (msg: string) => new HttpError(429, msg, "rate_limited");
