export function timeAgo(iso: string) {
  const delta = Math.max(0, Date.now() - new Date(iso).getTime());
  const sec = Math.floor(delta / 1000);
  if (sec < 45) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  return new Date(iso).toLocaleDateString();
}

export function lastSeenLabel(iso?: string | null, online?: boolean) {
  if (online) return "Active now";
  if (!iso) return "Offline";
  const label = timeAgo(iso);
  if (label === "just now") return "Last seen just now";
  return `Last seen ${label} ago`;
}
