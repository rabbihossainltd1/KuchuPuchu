export const WEB_FEATURE_FLAG_ENV = {
  serviceWorker: "VITE_KP_WEB_SERVICE_WORKER",
  accountIntegration: "VITE_KP_WEB_ACCOUNT_INTEGRATION",
  messaging: "VITE_KP_WEB_MESSAGING",
  statuses: "VITE_KP_WEB_STATUSES",
  media: "VITE_KP_WEB_MEDIA",
  calls: "VITE_KP_WEB_CALLS",
  push: "VITE_KP_WEB_PUSH",
} as const;

export type WebFeatureFlag = keyof typeof WEB_FEATURE_FLAG_ENV;
type FeatureFlagEnvironmentKey = (typeof WEB_FEATURE_FLAG_ENV)[WebFeatureFlag];
export type WebFeatureFlagEnvironment = Partial<
  Record<FeatureFlagEnvironmentKey, string | undefined>
>;
export type WebFeatureFlags = Readonly<Record<WebFeatureFlag, boolean>>;

export const WEB_FEATURE_FLAG_DEFAULTS: WebFeatureFlags = Object.freeze({
  serviceWorker: true,
  accountIntegration: false,
  messaging: false,
  statuses: false,
  media: false,
  calls: false,
  push: false,
});

function parseFlag(value: string | undefined, fallback: boolean): boolean {
  switch (value?.trim().toLowerCase()) {
    case "true":
      return true;
    case "false":
      return false;
    default:
      return fallback;
  }
}

/** Resolve public, build-time Vite flags. Flags are rollout controls, not authorization. */
export function resolveWebFeatureFlags(environment: WebFeatureFlagEnvironment): WebFeatureFlags {
  return Object.freeze({
    serviceWorker: parseFlag(
      environment[WEB_FEATURE_FLAG_ENV.serviceWorker],
      WEB_FEATURE_FLAG_DEFAULTS.serviceWorker,
    ),
    accountIntegration: parseFlag(
      environment[WEB_FEATURE_FLAG_ENV.accountIntegration],
      WEB_FEATURE_FLAG_DEFAULTS.accountIntegration,
    ),
    messaging: parseFlag(
      environment[WEB_FEATURE_FLAG_ENV.messaging],
      WEB_FEATURE_FLAG_DEFAULTS.messaging,
    ),
    statuses: parseFlag(
      environment[WEB_FEATURE_FLAG_ENV.statuses],
      WEB_FEATURE_FLAG_DEFAULTS.statuses,
    ),
    media: parseFlag(environment[WEB_FEATURE_FLAG_ENV.media], WEB_FEATURE_FLAG_DEFAULTS.media),
    calls: parseFlag(environment[WEB_FEATURE_FLAG_ENV.calls], WEB_FEATURE_FLAG_DEFAULTS.calls),
    push: parseFlag(environment[WEB_FEATURE_FLAG_ENV.push], WEB_FEATURE_FLAG_DEFAULTS.push),
  });
}
