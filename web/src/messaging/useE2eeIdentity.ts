/**
 * Roaming E2EE identity for the browser.
 *
 * Behaviour is the app's, deliberately: adopt the account's existing keypair,
 * never mint a second identity while a passphrase-locked backup exists, and
 * publish the public key only when the server's copy differs. A second identity
 * would strand every envelope the phone already wrote.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../auth/authApi";
import { E2EE_STORAGE_KEY } from "../auth/storage";
import {
  decodePlaintextBackup,
  generateIdentity,
  isPassphraseBackup,
  isValidPublicKey,
  parseStoredIdentity,
  unlockPassphraseBackup,
  type E2eeIdentity,
} from "./e2ee";
import { messagingApi } from "./messagingApi";

export type IdentityStatus = "idle" | "loading" | "ready" | "locked" | "unavailable";

export type E2eeIdentityState = {
  identity: E2eeIdentity | null;
  status: IdentityStatus;
  /** Set while a KP2 backup waits for the owner's passphrase. */
  lockedBlob: string;
  error: string;
  notice: string;
  load: () => Promise<void>;
  unlock: (passphrase: string) => Promise<boolean>;
  dismissNotice: () => void;
};

function readStoredIdentity(): E2eeIdentity | null {
  try {
    return parseStoredIdentity(window.localStorage.getItem(E2EE_STORAGE_KEY));
  } catch {
    return null;
  }
}

function persistIdentity(identity: E2eeIdentity): void {
  try {
    window.localStorage.setItem(E2EE_STORAGE_KEY, JSON.stringify(identity));
  } catch {
    // The identity stays usable for this page lifetime even if storage is blocked.
  }
}

export function useE2eeIdentity(
  api: ApiClient,
  enabled: boolean,
  serverPublicKey: string,
): E2eeIdentityState {
  const [identity, setIdentity] = useState<E2eeIdentity | null>(() =>
    enabled ? readStoredIdentity() : null,
  );
  const [status, setStatus] = useState<IdentityStatus>(() =>
    !enabled ? "idle" : identity ? "ready" : "loading",
  );
  const [lockedBlob, setLockedBlob] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const identityRef = useRef(identity);
  identityRef.current = identity;

  /** Publish only the adopted public key; private backups require explicit KP2. */
  const publishIdentity = useCallback(
    async (adopted: E2eeIdentity) => {
      try {
        if (!isValidPublicKey(serverPublicKey) || serverPublicKey !== adopted.u) {
          await messagingApi.publishPublicKey(api, adopted.u);
        }
      } catch {
        setNotice(
          "Secure chat keys could not be published yet. Sending stays disabled until the next retry.",
        );
      }
    },
    [api, serverPublicKey],
  );

  const adopt = useCallback((adopted: E2eeIdentity) => {
    identityRef.current = adopted;
    setIdentity(adopted);
    persistIdentity(adopted);
    setLockedBlob("");
    setError("");
    setStatus("ready");
  }, []);

  const load = useCallback(async () => {
    if (!enabled) {
      setStatus("idle");
      return;
    }
    if (identityRef.current) {
      setStatus("ready");
      return;
    }

    setStatus("loading");
    let remote = "";
    try {
      remote = await messagingApi.getBackup(api);
    } catch {
      // Offline or unauthenticated: retry on the next mount. Until then a
      // personal chat refuses to send rather than risking a plaintext body.
      setStatus("unavailable");
      setError("Secure chat could not be prepared. Check your connection and retry.");
      return;
    }

    if (isPassphraseBackup(remote)) {
      setLockedBlob(remote);
      setStatus("locked");
      return;
    }

    const existing = decodePlaintextBackup(remote);
    if (existing) {
      adopt(existing);
      await publishIdentity(existing);
      return;
    }

    if (remote) {
      // A corrupt blob is not a licence to mint a replacement identity: that
      // would silently fork the account's keys.
      setStatus("unavailable");
      setError("The stored secure-chat backup could not be read. Open the phone app to repair it.");
      return;
    }

    // No backup anywhere: keep the minted private identity in browser storage;
    // publish only its public half. KP2 backup requires explicit user consent.
    const minted = await generateIdentity();
    adopt(minted);
    await publishIdentity(minted);
  }, [adopt, api, enabled, publishIdentity]);

  useEffect(() => {
    void load();
  }, [load]);

  const unlock = useCallback(
    async (passphrase: string): Promise<boolean> => {
      if (!lockedBlob) return false;
      const pair = await unlockPassphraseBackup(lockedBlob, passphrase);
      if (!pair) {
        setError("ভুল পাসফ্রেজ / wrong passphrase");
        return false;
      }
      adopt(pair);
      await publishIdentity(pair);
      setNotice("Secure chat unlocked. Encrypted messages can now be read and sent.");
      return true;
    },
    [adopt, lockedBlob, publishIdentity],
  );

  return {
    identity,
    status,
    lockedBlob,
    error,
    notice,
    load,
    unlock,
    dismissNotice: () => {
      setNotice("");
      setError("");
    },
  };
}
