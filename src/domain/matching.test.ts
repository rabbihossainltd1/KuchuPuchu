import { describe, expect, it } from "vitest";
import {
  genderCompatible,
  rankCandidates,
  scoreCandidate,
  type MatchablePlayer,
} from "./matching.js";

function player(partial: Partial<MatchablePlayer> & { userId: string }): MatchablePlayer {
  return {
    serverRegion: "SOUTH_ASIA",
    rank: "DIAMOND",
    preferredModes: ["CLASH_SQUAD"],
    playStyle: "IGL",
    languages: ["bn", "en"],
    availability: ["evening"],
    micPreference: "MIC_ON",
    country: "BD",
    district: "Rajshahi",
    lastActiveAt: new Date(),
    reputation: 50,
    gender: "MALE",
    genderPreference: "ANY",
    ...partial,
  };
}

describe("matching", () => {
  it("scores compatible teammates higher", () => {
    const viewer = player({ userId: "a" });
    const close = player({ userId: "b" });
    const far = player({
      userId: "c",
      serverRegion: "EUROPE",
      rank: "BRONZE",
      preferredModes: ["CRAFTLAND"],
      languages: ["es"],
      lastActiveAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    });
    const now = new Date();
    expect(scoreCandidate(viewer, close, now).score).toBeGreaterThan(
      scoreCandidate(viewer, far, now).score,
    );
  });

  it("returns explainable reasons", () => {
    const result = scoreCandidate(player({ userId: "a" }), player({ userId: "b" }));
    expect(result.reasons).toContain("Same mode");
    expect(result.reasons).toContain("Same server");
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("is deterministic", () => {
    const viewer = player({ userId: "a" });
    const candidates = [player({ userId: "c" }), player({ userId: "b", rank: "HEROIC" })];
    const first = rankCandidates(viewer, candidates).map((x) => x.userId);
    const second = rankCandidates(viewer, candidates).map((x) => x.userId);
    expect(first).toEqual(second);
  });

  it("respects gender preference", () => {
    const viewer = player({ userId: "a", genderPreference: "FEMALE" });
    expect(genderCompatible(viewer, player({ userId: "b", gender: "MALE" }))).toBe(false);
    expect(genderCompatible(viewer, player({ userId: "c", gender: "FEMALE" }))).toBe(true);
  });
});
