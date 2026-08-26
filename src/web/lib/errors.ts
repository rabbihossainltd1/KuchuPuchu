export type ApiError = {
  code: string;
  message: string;
  requestId?: string;
  details?: { path: string; message: string }[];
};

export class RequestError extends Error {
  status: number;
  body: ApiError;
  constructor(status: number, body: ApiError) {
    super(body.message);
    this.status = status;
    this.body = body;
  }
}
