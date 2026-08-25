import { createId } from "../../domain/ids.js";
import { AppError } from "../../shared/errors.js";
import { prisma } from "../db.js";
import { getSettings } from "../settings.js";
import { isBlocked, publicUser } from "./users.js";
import { notify } from "./notify.js";

async function friendIds(userId: string) {
  const rows = await prisma.relationship.findMany({
    where: { fromUserId: userId, type: "FRIEND" },
    select: { toUserId: true },
  });
  return rows.map((row) => row.toUserId);
}

async function blockedIds(userId: string) {
  const rows = await prisma.block.findMany({
    where: { OR: [{ fromUserId: userId }, { toUserId: userId }] },
  });
  return rows.map((row) => (row.fromUserId === userId ? row.toUserId : row.fromUserId));
}

export async function createPost(userId: string, body: string, visibility: "PUBLIC" | "FRIENDS") {
  const settings = await getSettings();
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const count = await prisma.post.count({ where: { authorId: userId, createdAt: { gte: since } } });
  if (count >= (settings.postHourlyLimit ?? 20)) {
    throw new AppError("RATE_LIMITED", "You are posting too quickly.", 429);
  }
  const post = await prisma.post.create({
    data: { id: createId("pst"), authorId: userId, body, visibility },
  });
  return serializePost(userId, post.id);
}

export async function deletePost(userId: string, postId: string) {
  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post || post.authorId !== userId) throw new AppError("NOT_FOUND", "Post not found.", 404);
  await prisma.post.delete({ where: { id: postId } });
}

export async function listFeed(userId: string, cursor?: string, limit = 20) {
  const friends = await friendIds(userId);
  const blocked = await blockedIds(userId);
  const items = await prisma.post.findMany({
    where: {
      authorId: { notIn: blocked },
      OR: [
        { authorId: userId },
        { visibility: "PUBLIC" },
        { visibility: "FRIENDS", authorId: { in: friends } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const nextCursor = items.length > limit ? items.pop()?.id : null;
  const serialized = await Promise.all(items.map((post) => serializePost(userId, post.id)));
  return { items: serialized, nextCursor };
}

export async function toggleLike(userId: string, postId: string) {
  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post) throw new AppError("NOT_FOUND", "Post not found.", 404);
  if (await isBlocked(userId, post.authorId)) throw new AppError("BLOCKED", "You cannot like this post.", 403);
  const existing = await prisma.postLike.findUnique({
    where: { postId_userId: { postId, userId } },
  });
  if (existing) {
    await prisma.postLike.delete({ where: { id: existing.id } });
  } else {
    await prisma.postLike.create({ data: { id: createId("plk"), postId, userId } });
    if (post.authorId !== userId) {
      await notify({
        userId: post.authorId,
        type: "like",
        title: "New like",
        body: "Someone liked your post.",
        link: "/home",
        dedupeKey: `like-${postId}-${userId}`,
      });
    }
  }
  return serializePost(userId, postId);
}

export async function addComment(userId: string, postId: string, body: string) {
  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post) throw new AppError("NOT_FOUND", "Post not found.", 404);
  if (await isBlocked(userId, post.authorId)) {
    throw new AppError("BLOCKED", "You cannot comment on this post.", 403);
  }
  await prisma.postComment.create({
    data: { id: createId("pcm"), postId, authorId: userId, body },
  });
  if (post.authorId !== userId) {
    await notify({
      userId: post.authorId,
      type: "comment",
      title: "New comment",
      body: body.slice(0, 80),
      link: "/home",
    });
  }
  return serializePost(userId, postId);
}

export async function serializePost(viewerId: string, postId: string) {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: {
      likes: true,
      comments: { orderBy: { createdAt: "asc" }, take: 12 },
    },
  });
  if (!post) throw new AppError("NOT_FOUND", "Post not found.", 404);
  const comments = await Promise.all(
    post.comments.map(async (comment) => ({
      id: comment.id,
      body: comment.body,
      createdAt: comment.createdAt.toISOString(),
      author: await publicUser(viewerId, comment.authorId).catch(() => null),
    })),
  );
  return {
    id: post.id,
    body: post.body,
    visibility: post.visibility,
    createdAt: post.createdAt.toISOString(),
    author: await publicUser(viewerId, post.authorId),
    likeCount: post.likes.length,
    liked: post.likes.some((like) => like.userId === viewerId),
    commentCount: post.comments.length,
    comments: comments.filter((item) => item.author),
  };
}

export async function listFriends(userId: string) {
  const ids = await friendIds(userId);
  return Promise.all(ids.map((id) => publicUser(userId, id)));
}

export async function listFriendRequests(userId: string) {
  const items = await prisma.friendRequest.findMany({
    where: { toUserId: userId, status: "PENDING" },
    orderBy: { createdAt: "desc" },
  });
  return Promise.all(
    items.map(async (item) => ({
      id: item.id,
      createdAt: item.createdAt.toISOString(),
      from: await publicUser(userId, item.fromUserId),
    })),
  );
}
