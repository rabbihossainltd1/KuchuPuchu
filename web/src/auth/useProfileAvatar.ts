import { useCallback, useEffect, useState } from "react";
import type { ApiClient, AuthUser } from "./authApi";
import { useAvatar } from "../messaging/avatars";

type AvatarSource = "url" | "ref" | "none";

/** Prefer the API's direct photo URL, then resolve the stable avatarRef. */
export function useProfileAvatar(api: ApiClient | null, user: AuthUser | null) {
  const [source, setSource] = useState<AvatarSource>(() =>
    user?.avatarUrl ? "url" : user?.avatarRef ? "ref" : "none",
  );
  const [failed, setFailed] = useState(false);
  const avatarRef = source === "ref" ? (user?.avatarRef ?? "") : "";
  const resolvedRef = useAvatar(api, avatarRef);

  useEffect(() => {
    setSource(user?.avatarUrl ? "url" : user?.avatarRef ? "ref" : "none");
    setFailed(false);
  }, [user?.avatarRef, user?.avatarUrl]);

  const onError = useCallback(() => {
    if (source === "url" && user?.avatarRef) {
      setSource("ref");
      setFailed(false);
      return;
    }
    setFailed(true);
  }, [source, user?.avatarRef]);

  const src = failed
    ? null
    : source === "url"
      ? (user?.avatarUrl ?? null)
      : source === "ref"
        ? resolvedRef
        : null;

  return { src, onError };
}
