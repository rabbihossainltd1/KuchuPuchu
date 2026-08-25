import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createId } from "../../domain/ids.js";
import { AppError } from "../../shared/errors.js";
import { prisma } from "../db.js";
import { isBlocked, publicUser } from "./users.js";

const STORY_TTL_MS = 24 * 60 * 60 * 1000;
const STORY_HOURLY_LIMIT = 8;

async function friendIds(userId: string) {
  const rows = await prisma.relationship.findMany({
    where: { fromUserId: userId, type: "FRIEND" },
    select: { toUserId: true },
  });
  return rows.map((row) => row.toUserId);
}

function parseImageData(imageData: string) {
  const match = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=\s]+)$/i.exec(imageData.trim());
  if (!match?.[1] || !match[2]) throw new AppError("INVALID_IMAGE", "Use a JPEG, PNG, or WebP photo.", 400);
  const ext = match[1].toLowerCase() === "jpg" ? "jpeg" : match[1].toLowerCase();
  const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (buffer.length < 80) throw new AppError("INVALID_IMAGE", "That photo could not be read.", 400);
  if (buffer.length > 1_500_000) throw new AppError("IMAGE_TOO_LARGE", "Keep photos under 1.5 MB.", 400);
  return { ext, buffer };
}

export async function createStory(userId: string, input: { body?: string | null; imageData?: string | null }) {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const count = await prisma.story.count({ where: { authorId: userId, createdAt: { gte: since } } });
  if (count >= STORY_HOURLY_LIMIT) {
    throw new AppError("RATE_LIMITED", "You are sharing stories too quickly.", 429);
  }
  const id = createId("sty");
  let imageUrl: string | null = null;
  if (input.imageData) {
    const { ext, buffer } = parseImageData(input.imageData);
    const dir = path.resolve(process.cwd(), "uploads/stories");
    await mkdir(dir, { recursive: true });
    const file = `${id}.${ext === "jpeg" ? "jpg" : ext}`;
    await writeFile(path.join(dir, file), buffer);
    imageUrl = `/uploads/stories/${file}`;
  }
  const body = input.body?.trim() || null;
  if (!body && !imageUrl) throw new AppError("EMPTY_STORY", "Add a photo or a short caption.", 400);
  await prisma.story.create({
    data: {
      id,
      authorId: userId,
      body,
      imageUrl,
      expiresAt: new Date(Date.now() + STORY_TTL_MS),
    },
  });
  return listStories(userId);
}

export async function deleteStory(userId: string, storyId: string) {
  const story = await prisma.story.findUnique({ where: { id: storyId } });
  if (!story || story.authorId !== userId) throw new AppError("NOT_FOUND", "Story not found.", 404);
  await prisma.story.delete({ where: { id: storyId } });
}

export async function viewStory(userId: string, storyId: string) {
  const story = await prisma.story.findUnique({ where: { id: storyId } });
  if (!story || story.expiresAt < new Date()) throw new AppError("NOT_FOUND", "Story not found.", 404);
  if (story.authorId !== userId && (await isBlocked(userId, story.authorId))) {
    throw new AppError("BLOCKED", "You cannot view this story.", 403);
  }
  await prisma.storyView.upsert({
    where: { storyId_viewerId: { storyId, viewerId: userId } },
    update: {},
    create: { id: createId("stv"), storyId, viewerId: userId },
  });
  return { ok: true };
}

export async function expireStories() {
  await prisma.story.deleteMany({ where: { expiresAt: { lt: new Date() } } });
}

export async function listStories(userId: string) {
  const friends = await friendIds(userId);
  const allowed = [userId, ...friends];
  const rows = await prisma.story.findMany({
    where: { authorId: { in: allowed }, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "asc" },
  });
  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = grouped.get(row.authorId) ?? [];
    list.push(row);
    grouped.set(row.authorId, list);
  }
  const authorIds = [userId, ...friends.filter((id) => grouped.has(id) && id !== userId)];
  const items = [];
  for (const authorId of authorIds) {
    const stories = grouped.get(authorId);
    if (!stories?.length) continue;
    const views = await prisma.storyView.findMany({
      where: { viewerId: userId, storyId: { in: stories.map((item) => item.id) } },
      select: { storyId: true },
    });
    const seenIds = new Set(views.map((item) => item.storyId));
    items.push({
      author: await publicUser(userId, authorId),
      seen: stories.every((item) => seenIds.has(item.id)),
      stories: stories.map((item) => ({
        id: item.id,
        body: item.body,
        imageUrl: item.imageUrl,
        createdAt: item.createdAt.toISOString(),
        expiresAt: item.expiresAt.toISOString(),
        seen: seenIds.has(item.id),
        mine: item.authorId === userId,
      })),
    });
  }
  return { items };
}
