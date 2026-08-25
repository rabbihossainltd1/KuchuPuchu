const fromEnv = String(import.meta.env.VITE_API_BASE ?? "")
  .trim()
  .replace(/\/$/, "");

export function isNativeApp() {
  if (typeof window === "undefined") return false;
  const cap = (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return Boolean(cap?.isNativePlatform?.());
}

export function getApiBase() {
  if (fromEnv) return fromEnv;
  if (isNativeApp()) return PRODUCTION_API;
  return "";
}

export function apiUrl(path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  const base = getApiBase();
  if (!base) return path;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

export function mediaUrl(path?: string | null) {
  if (!path) return path ?? null;
  if (/^https?:\/\//i.test(path) || path.startsWith("data:")) return path;
  return apiUrl(path);
}
