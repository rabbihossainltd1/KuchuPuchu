import { Router } from "express";
import { asyncHandler } from "../http.js";
import { requireAuth } from "../middleware/auth.js";
import {
  notificationPrefSchema,
  privacyPatchSchema,
  profilePatchSchema,
} from "../../domain/validation.js";
import {
  getMe,
  publicUser,
  reputationFor,
  updatePrivacy,
  updateProfile,
} from "../services/users.js";
import { prisma } from "../db.js";
import type { AuthedRequest } from "../types.js";

export const meRouter = Router();

meRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: await getMe((req as AuthedRequest).user.id) });
  }),
);

meRouter.patch(
  "/me/profile",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = profilePatchSchema.parse(req.body);
    res.json({ user: await updateProfile((req as AuthedRequest).user.id, body) });
  }),
);

meRouter.patch(
  "/me/preferences",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = profilePatchSchema
      .pick({
        preferredModes: true,
        playStyle: true,
        languages: true,
        availability: true,
        micPreference: true,
        genderPreference: true,
        serverRegion: true,
        rank: true,
      })
      .parse(req.body);
    res.json({ user: await updateProfile((req as AuthedRequest).user.id, body) });
  }),
);

meRouter.patch(
  "/me/privacy",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = privacyPatchSchema.parse(req.body);
    res.json({ user: await updatePrivacy((req as AuthedRequest).user.id, body) });
  }),
);

meRouter.patch(
  "/me/notifications",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = notificationPrefSchema.parse(req.body);
    const userId = (req as AuthedRequest).user.id;
    await prisma.notificationPreference.update({ where: { userId }, data: body });
    res.json({ user: await getMe(userId) });
  }),
);

meRouter.get(
  "/me/export",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = (req as AuthedRequest).user.id;
    const [user, ledger, inventory, messages, reports] = await Promise.all([
      getMe(userId),
      prisma.coinLedger.findMany({ where: { userId } }),
      prisma.inventoryItem.findMany({ where: { ownerId: userId }, include: { product: true } }),
      prisma.message.findMany({ where: { senderId: userId } }),
      prisma.report.findMany({ where: { reporterId: userId } }),
    ]);
    res.json({ exportedAt: new Date().toISOString(), user, ledger, inventory, messages, reports });
  }),
);

meRouter.get(
  "/users/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const viewer = req as AuthedRequest;
    res.json({
      user: await publicUser(viewer.user.id, String(req.params.id), Boolean(viewer.adminRole)),
    });
  }),
);

meRouter.get(
  "/users/:id/reputation",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ reputation: await reputationFor(String(req.params.id)) });
  }),
);
