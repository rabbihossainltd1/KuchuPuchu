import {
  resolveWebFeatureFlags,
  type WebFeatureFlag,
  type WebFeatureFlagEnvironment,
} from "./featureFlagRegistry";

export const webFeatureFlags = resolveWebFeatureFlags(import.meta.env as WebFeatureFlagEnvironment);

export function isWebFeatureEnabled(feature: WebFeatureFlag): boolean {
  return webFeatureFlags[feature];
}
