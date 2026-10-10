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

export type IdentityStatus = "idle" | "loading" | "ready" | "locked" | "nokeys" | "unavailable";

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
    // A stored keypair that disagrees with the account's published public key
    // is a minted fork (an older build created it before the no-mint rule).
    // It can never open what peers sealed to the real key, so drop it and let
    // the backup flow below adopt the account's actual identity.
    if (
      identityRef.current &&
      isValidPublicKey(serverPublicKey) &&
      identityRef.current.u !== serverPublicKey
    ) {
      identityRef.current = null;
      setIdentity(null);
      try {
        window.localStorage.removeItem(E2EE_STORAGE_KEY);
      } catch {
        // Storage already gone; nothing to drop.
      }
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

    // No backup anywhere. If the account already has a published key (the
    // phone minted it), minting a second keypair here would strand every
    // envelope the phone sealed — received bodies could never open on this
    // browser, and this is exactly the "message bodies read wrong" failure
    // the live round reported. Stand down and point at the phone's backup;
    // "Check for backup" re-runs this once the phone uploads one.
    if (isValidPublicKey(serverPublicKey)) {
      setStatus("nokeys");
      return;
    }

    // A keyless account (no phone key published yet) may mint: keep the minted
    // private identity in browser storage; publish only its public half. KP2
    // backup requires explicit user consent.
    const minted = await generateIdentity();
    adopt(minted);
    await publishIdentity(minted);
  }, [adopt, api, enabled, publishIdentity, serverPublicKey]);

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
