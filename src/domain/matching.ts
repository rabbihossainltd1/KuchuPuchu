import {
  DEFAULT_MATCH_WEIGHTS,
  ONLINE_WINDOW_MS,
  RANK_INDEX,
  type Rank,
} from "../shared/constants.js";

export type MatchWeights = {
  mode: number;
  server: number;
  availability: number;
  rank: number;
  language: number;
  playStyle: number;
  activity: number;
  proximity: number;
  reputation: number;
  mic: number;
};

export type MatchablePlayer = {
  userId: string;
  serverRegion: string | null;
  rank: string | null;
  preferredModes: string[];
  playStyle: string | null;
  languages: string[];
  availability: string[];
  micPreference: string | null;
  country: string | null;
  district: string | null;
  lastActiveAt: Date;
  reputation: number;
  gender: string | null;
  genderPreference: string | null;
};

export type ScoredCandidate = {
  userId: string;
  score: number;
  reasons: string[];
};

export function normalizeWeights(weights: Partial<MatchWeights> = {}): MatchWeights {
  return { ...DEFAULT_MATCH_WEIGHTS, ...weights };
}

function overlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const set = new Set(a);
  const hits = b.filter((x) => set.has(x)).length;
  return hits / Math.max(a.length, b.length);
}

function rankDistance(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const ia = RANK_INDEX[a as Rank];
  const ib = RANK_INDEX[b as Rank];
  if (ia === undefined || ib === undefined) return null;
  return Math.abs(ia - ib);
}

export function genderCompatible(viewer: MatchablePlayer, candidate: MatchablePlayer): boolean {
  const viewerOk =
    !viewer.genderPreference ||
    viewer.genderPreference === "ANY" ||
    !candidate.gender ||
    candidate.gender === "UNDISCLOSED" ||
    candidate.gender === viewer.genderPreference;
  const candidateOk =
    !candidate.genderPreference ||
    candidate.genderPreference === "ANY" ||
    !viewer.gender ||
    viewer.gender === "UNDISCLOSED" ||
    viewer.gender === candidate.genderPreference;
  return viewerOk && candidateOk;
}

export function scoreCandidate(
  viewer: MatchablePlayer,
  candidate: MatchablePlayer,
  now = new Date(),
  rawWeights: Partial<MatchWeights> = {},
): ScoredCandidate {
  const weights = normalizeWeights(rawWeights);
  const reasons: string[] = [];
  let score = 0;

  const modeScore = overlap(viewer.preferredModes, candidate.preferredModes);
  score += modeScore * weights.mode;
  if (modeScore > 0) reasons.push("Same mode");

  if (
    viewer.serverRegion &&
    candidate.serverRegion &&
    viewer.serverRegion === candidate.serverRegion
  ) {
    score += weights.server;
    reasons.push("Same server");
  }

  const avail = overlap(viewer.availability, candidate.availability);
  score += avail * weights.availability;
  if (avail > 0) reasons.push("Overlapping availability");

  const dist = rankDistance(viewer.rank, candidate.rank);
  if (dist !== null) {
    const rankScore = Math.max(0, 1 - dist / 6);
    score += rankScore * weights.rank;
    if (dist <= 1) reasons.push("Similar rank");
  }

  const lang = overlap(viewer.languages, candidate.languages);
  score += lang * weights.language;
  if (lang > 0) reasons.push("Same language");

  if (viewer.playStyle && candidate.playStyle && viewer.playStyle === candidate.playStyle) {
    score += weights.playStyle;
    reasons.push("Similar play style");
  }

  const ageMs = now.getTime() - candidate.lastActiveAt.getTime();
  if (ageMs <= ONLINE_WINDOW_MS) {
    score += weights.activity;
    reasons.push("Active now");
  } else if (ageMs <= 24 * 60 * 60 * 1000) {
    score += weights.activity * 0.4;
  }

  if (viewer.country && candidate.country && viewer.country === candidate.country) {
    score += weights.proximity * 0.6;
    if (viewer.district && candidate.district && viewer.district === candidate.district) {
      score += weights.proximity * 0.4;
    }
  }

  const rep = Math.max(0, Math.min(100, candidate.reputation)) / 100;
  score += rep * weights.reputation;

  if (viewer.micPreference && candidate.micPreference) {
    if (
      viewer.micPreference === candidate.micPreference ||
      candidate.micPreference === "OPTIONAL"
    ) {
      score += weights.mic;
    }
  }

  return {
    userId: candidate.userId,
    score: Math.round(score * 100) / 100,
    reasons: reasons.slice(0, 4),
  };
}

export function rankCandidates(
  viewer: MatchablePlayer,
  candidates: MatchablePlayer[],
  now = new Date(),
  weights: Partial<MatchWeights> = {},
): ScoredCandidate[] {
  return candidates
    .filter((c) => c.userId !== viewer.userId)
    .filter((c) => genderCompatible(viewer, c))
    .map((c) => scoreCandidate(viewer, c, now, weights))
    .sort((a, b) => b.score - a.score || a.userId.localeCompare(b.userId));
}
