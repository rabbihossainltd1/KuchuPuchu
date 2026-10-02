import { isDeepStrictEqual } from "node:util";
import {
  WEB_FEATURE_FLAG_DEFAULTS,
  WEB_FEATURE_FLAG_ENV,
  resolveWebFeatureFlags,
} from "../../web/src/featureFlagRegistry.ts";

const lines = [];
const check = (name, condition, detail = "") =>
  lines.push(`  ${condition ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);

const defaults = resolveWebFeatureFlags({});
check(
  "new app-shell service worker is enabled by default",
  defaults.serviceWorker === true && WEB_FEATURE_FLAG_DEFAULTS.serviceWorker === true,
);
check(
  "unimplemented account, messaging, status, media, and call features default off",
  [
    defaults.accountIntegration,
    defaults.messaging,
    defaults.statuses,
    defaults.media,
    defaults.calls,
  ].every((enabled) => enabled === false),
);

const configured = resolveWebFeatureFlags({
  [WEB_FEATURE_FLAG_ENV.serviceWorker]: "false",
  [WEB_FEATURE_FLAG_ENV.accountIntegration]: "true",
  [WEB_FEATURE_FLAG_ENV.messaging]: "true",
  [WEB_FEATURE_FLAG_ENV.statuses]: "false",
  [WEB_FEATURE_FLAG_ENV.media]: "true",
  [WEB_FEATURE_FLAG_ENV.calls]: "false",
});
check(
  "explicit true/false values override each default",
  isDeepStrictEqual(configured, {
    serviceWorker: false,
    accountIntegration: true,
    messaging: true,
    statuses: false,
    media: true,
    calls: false,
  }),
);

const normalized = resolveWebFeatureFlags({
  [WEB_FEATURE_FLAG_ENV.accountIntegration]: " TRUE ",
  [WEB_FEATURE_FLAG_ENV.calls]: "False",
});
check("flag values are whitespace-trimmed and case-insensitive", normalized.accountIntegration);
check("false string disables a default-off feature", !normalized.calls);

const invalidValues = resolveWebFeatureFlags({
  [WEB_FEATURE_FLAG_ENV.serviceWorker]: "enabled",
  [WEB_FEATURE_FLAG_ENV.accountIntegration]: "yes",
  [WEB_FEATURE_FLAG_ENV.calls]: "1",
});
check(
  "unknown flag values fall back safely instead of becoming truthy",
  isDeepStrictEqual(invalidValues, defaults),
);
check(
  "resolved feature flags are immutable",
  Object.isFrozen(defaults) && Object.isFrozen(configured),
);
check(
  "account flow environment name is stable",
  WEB_FEATURE_FLAG_ENV.accountIntegration === "VITE_KP_WEB_ACCOUNT_INTEGRATION",
);

console.log(lines.join("\n"));
const broken = lines.filter((line) => line.includes("BROKEN")).length;
console.log(`case 52: ${lines.length} checks, ${broken} broken`);
process.exit(broken ? 1 : 0);
