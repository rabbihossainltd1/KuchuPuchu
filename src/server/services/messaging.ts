import { createId } from "../../domain/ids.js";
import { AppError } from "../../shared/errors.js";
import { prisma } from "../db.js";
import { getSettings } from "../settings.js";
import { notify } from "./notify.js";
import { assertCanMessage, publicUser } from "./users.js";

function pair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export async function getOrCreateConversation(userId: string, otherId: string) {
  if (userId === otherId) throw new AppError("INVALID", "You cannot message yourself.", 400);
  await assertCanMessage(userId, otherId);
  const [userAId, userBId] = pair(userId, otherId);
  return prisma.conversation.upsert({
    where: { userAId_userBId: { userAId, userBId } },
    create: { id: createId("cnv"), userAId, userBId },
    update: {},
  });
}

export async function listConversations(userId: string) {
  const rows = await prisma.conversation.findMany({
    where: { OR: [{ userAId: userId }, { userBId: userId }] },
    orderBy: { lastMessageAt: "desc" },
    include: {
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  return Promise.all(
    rows.map(async (row) => {
      const otherId = row.userAId === userId ? row.userBId : row.userAId;
      const unread = await prisma.message.count({
        where: { conversationId: row.id, senderId: { not: userId }, readAt: null },
      });
      return {
        id: row.id,
        other: await publicUser(userId, otherId),
        lastMessage: row.messages[0] ?? null,
        unread,
        lastMessageAt: row.lastMessageAt,
      };
    }),
  );
}

export async function listMessages(
  userId: string,
  conversationId: string,
  cursor?: string,
  limit = 30,
) {
  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
  if (!conversation || (conversation.userAId !== userId && conversation.userBId !== userId)) {
    throw new AppError("NOT_FOUND", "Conversation not found.", 404);
  }
  const items = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  await prisma.message.updateMany({
    where: { conversationId, senderId: { not: userId }, readAt: null },
    data: { readAt: new Date() },
  });
  const nextCursor = items.length > limit ? items.pop()?.id : null;
  return { items: items.reverse(), nextCursor };
}

export async function sendMessage(userId: string, conversationId: string, body: string) {
  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
  if (!conversation || (conversation.userAId !== userId && conversation.userBId !== userId)) {
    throw new AppError("NOT_FOUND", "Conversation not found.", 404);
  }
  const otherId = conversation.userAId === userId ? conversation.userBId : conversation.userAId;
  await assertCanMessage(userId, otherId);
  const settings = await getSettings();
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const count = await prisma.message.count({
    where: { senderId: userId, createdAt: { gte: since } },
  });
  if (count >= settings.messageHourlyLimit) {
    throw new AppError("RATE_LIMITED", "You are sending messages too quickly.", 429);
  }
  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.message.create({
      data: {
        id: createId("msg"),
        conversationId,
        senderId: userId,
        body,
      },
    });
    await tx.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: created.createdAt },
    });
    return created;
  });
  await notify({
    userId: otherId,
    type: "message",
    title: "New message",
    body: body.slice(0, 80),
    link: `/messages/${conversationId}`,
  });
  return message;
}
