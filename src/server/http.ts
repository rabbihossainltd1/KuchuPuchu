import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { nanoid } from "nanoid";
import { isAppError } from "../shared/errors.js";

export function requestId(req: Request, res: Response, next: NextFunction) {
  const id = (req.header("x-request-id") || nanoid(16)).slice(0, 64);
  res.locals.requestId = id;
  res.setHeader("x-request-id", id);
  next();
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const requestIdValue = String(res.locals.requestId ?? "");
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Please check the highlighted fields.",
        requestId: requestIdValue,
        details: err.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
    });
    return;
  }
  if (isAppError(err)) {
    res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        requestId: requestIdValue,
        details: err.details,
      },
    });
    return;
  }
  console.error("Unhandled error", { requestId: requestIdValue, err });
  res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "Something went wrong. Please try again.",
      requestId: requestIdValue,
    },
  });
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res, next).catch(next);
  };
}
