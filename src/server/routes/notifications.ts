import { Router } from "express";
import { asyncHandler } from "../http.js";
import { requireAuth } from "../middleware/auth.js";
import { paginationSchema } from "../../domain/validation.js";
import { prisma } from "../db.js";
import type { AuthedRequest } from "../types.js";

export const notificationRouter = Router();

notificationRouter.get(
  "/notifications",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = (req as AuthedRequest).user.id;
    const query = paginationSchema.parse(req.query);
    const items = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: (query.limit ?? 20) + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const nextCursor = items.length > (query.limit ?? 20) ? items.pop()?.id : null;
    const unread = await prisma.notification.count({ where: { userId, readAt: null } });
    res.json({ items, nextCursor, unread });
  }),
);

notificationRouter.post(
  "/notifications/read",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = (req as AuthedRequest).user.id;
    const ids = Array.isArray((req.body as { ids?: string[] }).ids)
      ? (req.body as { ids: string[] }).ids
      : [];
    await prisma.notification.updateMany({
      where: ids.length ? { userId, id: { in: ids } } : { userId, readAt: null },
      data: { readAt: new Date() },
    });
    res.json({ ok: true });
  }),
);
