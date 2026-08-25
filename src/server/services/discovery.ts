import {
  RANK_INDEX,
  type Rank,
  ONLINE_WINDOW_MS,
  DISMISSAL_TTL_MS,
} from "../../shared/constants.js";
import { rankCandidates, type MatchablePlayer } from "../../domain/matching.js";
import { AppError } from "../../shared/errors.js";
import { createId } from "../../domain/ids.js";
import { prisma } from "../db.js";
import { getMatchWeights, getSettings } from "../settings.js";
import { isBlocked, parseJsonArray, publicUser, reputationFor } from "./users.js";

export type DiscoverFilters = {
  cursor?: string;
  limit?: number;
  serverRegion?: string;
  country?: string;
  district?: string;
  rankMin?: string;
  rankMax?: string;
  mode?: string;
  playStyle?: string;
  language?: string;
  availability?: string;
  micPreference?: string;
  ageRange?: string;
  genderPreference?: string;
  online?: string;
  verified?: string;
  q?: string;
};

export async function discoverPlayers(viewerId: string, filters: DiscoverFilters) {
  const settings = await getSettings();
  const limit = filters.limit ?? settings.discoveryPageSize;
  const blocked = await prisma.block.findMany({
    where: { OR: [{ fromUserId: viewerId }, { toUserId: viewerId }] },
  });
  const blockedIds = new Set(
    blocked.map((b) => (b.fromUserId === viewerId ? b.toUserId : b.fromUserId)),
  );
  const dismissed = await prisma.discoveryDismissal.findMany({
    where: { userId: viewerId, until: { gt: new Date() } },
  });
  const dismissedIds = new Set(dismissed.map((d) => d.dismissedId));

  const rankMin = filters.rankMin ? RANK_INDEX[filters.rankMin as Rank] : undefined;
  const rankMax = filters.rankMax ? RANK_INDEX[filters.rankMax as Rank] : undefined;
  const allowedRanks =
    rankMin !== undefined || rankMax !== undefined
      ? Object.entries(RANK_INDEX)
          .filter(([, idx]) => {
            if (rankMin !== undefined && idx < rankMin) return false;
            if (rankMax !== undefined && idx > rankMax) return false;
            return true;
          })
          .map(([name]) => name)
      : undefined;

  const users = await prisma.user.findMany({
    where: {
      id: { not: viewerId },
      status: "ACTIVE",
      deletedAt: null,
      privacy: { discoverable: true },
      ...(filters.country ? { country: filters.country } : {}),
      ...(filters.district ? { district: filters.district } : {}),
      ...(filters.q
        ? {
            OR: [
              { displayName: { contains: filters.q } },
              { username: { contains: filters.q } },
              { profile: { ffIgn: { contains: filters.q } } },
            ],
          }
        : {}),
      profile: {
        ...(filters.serverRegion ? { serverRegion: filters.serverRegion } : {}),
        ...(allowedRanks ? { rank: { in: allowedRanks } } : {}),
        ...(filters.playStyle ? { playStyle: filters.playStyle } : {}),
        ...(filters.micPreference ? { micPreference: filters.micPreference } : {}),
        ...(filters.ageRange ? { ageRange: filters.ageRange } : {}),
        ...(filters.verified === "true" ? { verifiedFf: true } : {}),
      },
    },
    include: { profile: true, privacy: true },
    orderBy: { lastActiveAt: "desc" },
    take: 120,
  });

  const now = Date.now();
  const filtered = users.filter((user) => {
    if (blockedIds.has(user.id) || dismissedIds.has(user.id)) return false;
    const modes = parseJsonArray(user.profile?.preferredModesJson);
    const langs = parseJsonArray(user.profile?.languagesJson);
    const avail = parseJsonArray(user.profile?.availabilityJson);
    if (filters.mode && !modes.includes(filters.mode)) return false;
    if (filters.language && !langs.includes(filters.language)) return false;
    if (filters.availability && !avail.includes(filters.availability)) return false;
    if (filters.online === "true" && now - user.lastActiveAt.getTime() > ONLINE_WINDOW_MS)
      return false;
    return true;
  });

  const start = filters.cursor ? Number(filters.cursor) || 0 : 0;
  const page = filtered.slice(start, start + limit);
  const items = await Promise.all(page.map((user) => publicUser(viewerId, user.id)));
  return {
    items,
    nextCursor: start + limit < filtered.length ? String(start + limit) : null,
  };
}

export async function recommendPlayers(viewerId: string, limit = 20) {
  const viewer = await prisma.user.findUnique({
    where: { id: viewerId },
    include: { profile: true },
  });
  if (!viewer) throw new AppError("NOT_FOUND", "User not found.", 404);
  const { items } = await discoverPlayers(viewerId, { limit: 80 });
  const candidateModels: MatchablePlayer[] = [];
  for (const item of items) {
    const raw = await prisma.user.findUnique({
      where: { id: item.userId },
      include: { profile: true },
    });
    if (!raw?.profile) continue;
    candidateModels.push({
      userId: raw.id,
      serverRegion: raw.profile.serverRegion,
      rank: raw.profile.rank,
      preferredModes: parseJsonArray(raw.profile.preferredModesJson),
      playStyle: raw.profile.playStyle,
      languages: parseJsonArray(raw.profile.languagesJson),
      availability: parseJsonArray(raw.profile.availabilityJson),
      micPreference: raw.profile.micPreference,
      country: raw.country,
      district: raw.district,
      lastActiveAt: raw.lastActiveAt,
      reputation: await reputationFor(raw.id),
      gender: raw.profile.gender,
      genderPreference: raw.profile.genderPreference,
    });
  }
  const viewerModel: MatchablePlayer = {
    userId: viewer.id,
    serverRegion: viewer.profile?.serverRegion ?? null,
    rank: viewer.profile?.rank ?? null,
    preferredModes: parseJsonArray(viewer.profile?.preferredModesJson),
    playStyle: viewer.profile?.playStyle ?? null,
    languages: parseJsonArray(viewer.profile?.languagesJson),
    availability: parseJsonArray(viewer.profile?.availabilityJson),
    micPreference: viewer.profile?.micPreference ?? null,
    country: viewer.country,
    district: viewer.district,
    lastActiveAt: viewer.lastActiveAt,
    reputation: await reputationFor(viewer.id),
    gender: viewer.profile?.gender ?? null,
    genderPreference: viewer.profile?.genderPreference ?? null,
  };
  const weights = await getMatchWeights();
  const ranked = rankCandidates(viewerModel, candidateModels, new Date(), weights).slice(0, limit);
  const byId = new Map(items.map((i) => [i.userId, i]));
  return ranked
    .map((row) => {
      const player = byId.get(row.userId);
      if (!player) return null;
      return { ...player, score: row.score, reasons: row.reasons };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
}

export async function dismissPlayer(viewerId: string, targetId: string) {
  if (viewerId === targetId) throw new AppError("INVALID", "You cannot dismiss yourself.", 400);
  if (await isBlocked(viewerId, targetId)) return;
  await prisma.discoveryDismissal.upsert({
    where: { userId_dismissedId: { userId: viewerId, dismissedId: targetId } },
    create: {
      id: createId("dsm"),
      userId: viewerId,
      dismissedId: targetId,
      until: new Date(Date.now() + DISMISSAL_TTL_MS),
    },
    update: { until: new Date(Date.now() + DISMISSAL_TTL_MS) },
  });
}
