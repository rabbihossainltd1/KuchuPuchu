export type ReputationKind =
  | "match_completed"
  | "positive_feedback"
  | "verified_ff"
  | "report_confirmed"
  | "warning"
  | "restriction";

const DELTAS: Record<ReputationKind, number> = {
  match_completed: 3,
  positive_feedback: 2,
  verified_ff: 8,
  report_confirmed: -12,
  warning: -6,
  restriction: -20,
};

export function reputationDelta(kind: ReputationKind): number {
  return DELTAS[kind];
}

export function summarizeReputation(events: { delta: number }[]): number {
  const raw = events.reduce((sum, event) => sum + event.delta, 0);
  return Math.max(0, Math.min(100, 40 + raw));
}
