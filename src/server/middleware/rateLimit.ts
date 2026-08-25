import type { Request, Response, NextFunction } from "express";
import { AppError } from "../../shared/errors.js";
import { env } from "../env.js";

type Bucket = { timestamps: number[] };

const buckets = new Map<string, Bucket>();

export function rateLimit(options: {
  windowMs: number;
  max: number;
  key?: (req: Request) => string;
}) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (env.NODE_ENV === "test") {
      next();
      return;
    }
    const key = options.key?.(req) ?? `${req.ip}:${req.path}`;
    const now = Date.now();
    const bucket = buckets.get(key) ?? { timestamps: [] };
    bucket.timestamps = bucket.timestamps.filter((t) => now - t < options.windowMs);
    if (bucket.timestamps.length >= options.max) {
      next(new AppError("RATE_LIMITED", "Too many attempts. Please wait and try again.", 429));
      return;
    }
    bucket.timestamps.push(now);
    buckets.set(key, bucket);
    next();
  };
}

export function resetRateLimits() {
  buckets.clear();
}
