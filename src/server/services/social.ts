import { createId } from "../../domain/ids.js";
import { AppError } from "../../shared/errors.js";
import { DUO_REQUEST_TTL_MS } from "../../shared/constants.js";
import { prisma } from "../db.js";
import { getSettings } from "../settings.js";
import { notify } from "./notify.js";
import { assertCanRequest, isBlocked, publicUser } from "./users.js";
import { reputationDelta } from "../../domain/reputation.js";

export async function followUser(fromId: string, toId: string) {
  if (fromId === toId) throw new AppError("INVALID", "You cannot follow yourself.", 400);
  if (await isBlocked(fromId, toId))
    throw new AppError("BLOCKED", "You cannot follow this player.", 403);
  await prisma.relationship.upsert({
    where: { fromUserId_toUserId_type: { fromUserId: fromId, toUserId: toId, type: "FOLLOW" } },
    create: { id: createId("rel"), fromUserId: fromId, toUserId: toId, type: "FOLLOW" },
    update: {},
  });
  await notify({
    userId: toId,
    type: "follow",
    title: "New follower",
    body: "A player started following you.",
    link: `/players/${fromId}`,
    dedupeKey: `follow-${fromId}-${toId}`,
  });
}

export async function unfollowUser(fromId: string, toId: string) {
  await prisma.relationship.deleteMany({
    where: { fromUserId: fromId, toUserId: toId, type: "FOLLOW" },
  });
}

export async function sendFriendRequest(fromId: string, toId: string) {
  if (fromId === toId) throw new AppError("INVALID", "You cannot add yourself.", 400);
  await assertCanRequest(fromId, toId);
  const existingFriend = await prisma.relationship.findFirst({
    where: {
      type: "FRIEND",
      OR: [
        { fromUserId: fromId, toUserId: toId },
        { fromUserId: toId, toUserId: fromId },
      ],
    },
  });
  if (existingFriend) throw new AppError("ALREADY_FRIENDS", "You are already friends.", 409);
  const incoming = await prisma.friendRequest.findFirst({
    where: { fromUserId: toId, toUserId: fromId, status: "PENDING" },
  });
  if (incoming) return acceptFriendRequest(fromId, incoming.id);
  const existing = await prisma.friendRequest.findFirst({
    where: { fromUserId: fromId, toUserId: toId, status: "PENDING" },
  });
  if (existing) return existing;
  const created = await prisma.friendRequest.create({
    data: { id: createId("frq"), fromUserId: fromId, toUserId: toId, status: "PENDING" },
  });
  await notify({
    userId: toId,
    type: "friend_request",
    title: "Friend request",
    body: "Someone wants to add you as a friend.",
    link: "/requests",
  });
  return created;
}

export async function acceptFriendRequest(userId: string, requestId: string) {
  const request = await prisma.friendRequest.findUnique({ where: { id: requestId } });
  if (!request || request.toUserId !== userId || request.status !== "PENDING") {
    throw new AppError("NOT_FOUND", "Friend request not found.", 404);
  }
  await prisma.$transaction(async (tx) => {
    await tx.friendRequest.update({ where: { id: requestId }, data: { status: "ACCEPTED" } });
    await tx.relationship.upsert({
      where: {
        fromUserId_toUserId_type: {
          fromUserId: request.fromUserId,
          toUserId: request.toUserId,
          type: "FRIEND",
        },
      },
      create: {
        id: createId("rel"),
        fromUserId: request.fromUserId,
        toUserId: request.toUserId,
        type: "FRIEND",
      },
      update: {},
    });
    await tx.relationship.upsert({
      where: {
        fromUserId_toUserId_type: {
          fromUserId: request.toUserId,
          toUserId: request.fromUserId,
          type: "FRIEND",
        },
      },
      create: {
        id: createId("rel"),
        fromUserId: request.toUserId,
        toUserId: request.fromUserId,
        type: "FRIEND",
      },
      update: {},
    });
  });
  await notify({
    userId: request.fromUserId,
    type: "friend_accepted",
    title: "Friend request accepted",
    body: "You are now friends.",
    link: `/players/${userId}`,
  });
}

export async function declineFriendRequest(userId: string, requestId: string) {
  const request = await prisma.friendRequest.findUnique({ where: { id: requestId } });
  if (!request || request.toUserId !== userId || request.status !== "PENDING") {
    throw new AppError("NOT_FOUND", "Friend request not found.", 404);
  }
  await prisma.friendRequest.update({ where: { id: requestId }, data: { status: "DECLINED" } });
}

export async function blockUser(fromId: string, toId: string) {
  if (fromId === toId) throw new AppError("INVALID", "You cannot block yourself.", 400);
  await prisma.$transaction(async (tx) => {
    await tx.block.upsert({
      where: { fromUserId_toUserId: { fromUserId: fromId, toUserId: toId } },
      create: { id: createId("blk"), fromUserId: fromId, toUserId: toId },
      update: {},
    });
    await tx.relationship.deleteMany({
      where: {
        OR: [
          { fromUserId: fromId, toUserId: toId },
          { fromUserId: toId, toUserId: fromId },
        ],
      },
    });
    await tx.friendRequest.updateMany({
      where: {
        status: "PENDING",
        OR: [
          { fromUserId: fromId, toUserId: toId },
          { fromUserId: toId, toUserId: fromId },
        ],
      },
      data: { status: "DECLINED" },
    });
    await tx.duoRequest.updateMany({
      where: {
        status: "PENDING",
        OR: [
          { requesterId: fromId, targetId: toId },
          { requesterId: toId, targetId: fromId },
        ],
      },
      data: { status: "BLOCKED" },
    });
  });
}

export async function unblockUser(fromId: string, toId: string) {
  await prisma.block.deleteMany({ where: { fromUserId: fromId, toUserId: toId } });
}

export async function listBlocks(userId: string) {
  const rows = await prisma.block.findMany({
    where: { fromUserId: userId },
    orderBy: { createdAt: "desc" },
  });
  return Promise.all(rows.map((row) => publicUser(userId, row.toUserId)));
}

export async function createDuoRequest(
  userId: string,
  input: {
    targetId?: string;
    mode: string;
    preferredRankMin?: string;
    preferredRankMax?: string;
    availability?: string[];
    message?: string;
  },
) {
  const settings = await getSettings();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const count = await prisma.duoRequest.count({
    where: { requesterId: userId, createdAt: { gte: since } },
  });
  if (count >= settings.duoRequestDailyLimit) {
    throw new AppError("RATE_LIMITED", "You have reached today's duo request limit.", 429);
  }
  if (input.targetId) {
    if (input.targetId === userId)
      throw new AppError("INVALID", "You cannot request yourself.", 400);
    await assertCanRequest(userId, input.targetId);
  }
  const created = await prisma.duoRequest.create({
    data: {
      id: createId("duo"),
      requesterId: userId,
      targetId: input.targetId,
      mode: input.mode,
      preferredRankMin: input.preferredRankMin,
      preferredRankMax: input.preferredRankMax,
      availabilityJson: JSON.stringify(input.availability ?? []),
      message: input.message,
      expiresAt: new Date(Date.now() + DUO_REQUEST_TTL_MS),
      status: "PENDING",
    },
  });
  if (input.targetId) {
    await notify({
      userId: input.targetId,
      type: "duo_request",
      title: "Duo / Squad request",
      body: `A player invited you for ${input.mode.replaceAll("_", " ").toLowerCase()}.`,
      link: "/requests",
    });
  }
  return created;
}

export async function expireDueRequests() {
  await prisma.duoRequest.updateMany({
    where: { status: "PENDING", expiresAt: { lt: new Date() } },
    data: { status: "EXPIRED" },
  });
}

export async function listDuoRequests(userId: string) {
  await expireDueRequests();
  const rows = await prisma.duoRequest.findMany({
    where: {
      OR: [{ requesterId: userId }, { targetId: userId }],
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return Promise.all(
    rows.map(async (row) => ({
      ...row,
      requester: await publicUser(userId, row.requesterId),
      target: row.targetId ? await publicUser(userId, row.targetId) : null,
    })),
  );
}

export async function respondDuo(
  userId: string,
  requestId: string,
  action: "accept" | "decline" | "cancel",
) {
  await expireDueRequests();
  const request = await prisma.duoRequest.findUnique({ where: { id: requestId } });
  if (!request) throw new AppError("NOT_FOUND", "Request not found.", 404);
  if (request.status !== "PENDING")
    throw new AppError("INVALID_STATE", "This request is no longer pending.", 409);
  if (action === "cancel") {
    if (request.requesterId !== userId)
      throw new AppError("FORBIDDEN", "You cannot cancel this request.", 403);
    await prisma.duoRequest.update({ where: { id: requestId }, data: { status: "CANCELLED" } });
    return;
  }
  if (request.targetId !== userId)
    throw new AppError("FORBIDDEN", "You cannot respond to this request.", 403);
  if (action === "decline") {
    await prisma.duoRequest.update({ where: { id: requestId }, data: { status: "DECLINED" } });
    await notify({
      userId: request.requesterId,
      type: "duo_declined",
      title: "Request declined",
      body: "Your duo request was declined.",
      link: "/requests",
    });
    return;
  }
  await prisma.$transaction(async (tx) => {
    await tx.duoRequest.update({ where: { id: requestId }, data: { status: "ACCEPTED" } });
    await tx.match.create({
      data: {
        id: createId("mat"),
        userAId: request.requesterId,
        userBId: userId,
        requestId: request.id,
        mode: request.mode,
      },
    });
    await tx.reputationEvent.create({
      data: {
        id: createId("rep"),
        userId: request.requesterId,
        kind: "match_completed",
        delta: reputationDelta("match_completed"),
        source: request.id,
      },
    });
    await tx.reputationEvent.create({
      data: {
        id: createId("rep"),
        userId,
        kind: "match_completed",
        delta: reputationDelta("match_completed"),
        source: request.id,
      },
    });
  });
  await notify({
    userId: request.requesterId,
    type: "duo_accepted",
    title: "Request accepted",
    body: "Your duo request was accepted. Time to queue up.",
    link: "/messages",
  });
}

export async function listMatches(userId: string) {
  const rows = await prisma.match.findMany({
    where: { OR: [{ userAId: userId }, { userBId: userId }] },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return Promise.all(
    rows.map(async (row) => ({
      ...row,
      other: await publicUser(userId, row.userAId === userId ? row.userBId : row.userAId),
    })),
  );
}

export async function createReport(
  reporterId: string,
  input: {
    targetUserId: string;
    category: string;
    details: string;
  },
) {
  if (reporterId === input.targetUserId) {
    throw new AppError("INVALID", "You cannot report yourself.", 400);
  }
  const settings = await getSettings();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const count = await prisma.report.count({ where: { reporterId, createdAt: { gte: since } } });
  if (count >= settings.reportDailyLimit) {
    throw new AppError("RATE_LIMITED", "You have reached today's report limit.", 429);
  }
  return prisma.report.create({
    data: {
      id: createId("rpt"),
      reporterId,
      targetUserId: input.targetUserId,
      category: input.category,
      details: input.details,
      status: "SUBMITTED",
    },
  });
}
