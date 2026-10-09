/**
 * The calls layer: the engine owner.
 *
 * It is mounted once, above the routes, whenever the `calls` rollout flag is on
 * and a session is verified — because a ring has to be catchable on ANY tab, not
 * only on /calls. It owns:
 *
 * - the engine (created once per session, disposed on unmount),
 * - the single `<audio>` element that plays remote sound (and is therefore the
 *   element `setSinkId` moves — every video surface in `CallStage` is muted, so a
 *   call can never play one stream twice),
 * - the Calls tab's history controller, invalidated the moment a call ends so the
 *   new row does not wait out the 20 s cache,
 * - the launcher registered in `callBus`, which is how a chat header starts a
 *   call without importing the engine into the messaging chunk.
 *
 * The ring screen's "Message" button is the one place this layer touches
 * messaging: the phone declines and sends a canned reply, and a reply is an
 * ordinary 1:1 message, so it is sealed with the roaming identity exactly like a
 * status reply is. Plaintext would leave it readable on the server.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useAuth } from "../auth/AuthContext";
import { apiErrorMessage } from "../api";
import { isWebFeatureEnabled } from "../featureFlags";
import { messagingApi } from "../messaging/messagingApi";
import { newClientId } from "../messaging/protocol";
import { protectOutgoingBody } from "../messaging/e2ee";
import { useE2eeIdentity } from "../messaging/useE2eeIdentity";
import type { AppRoute } from "../router";
import type { Navigate } from "../useBrowserRouter";
import { CallStage } from "./CallStage";
import { CallsWorkspace } from "./CallsWorkspace";
import {
  INITIAL_CALL_STATE,
  browserClock,
  browserStore,
  createCallEngine,
  visibilityOf,
  type CallEngine,
} from "./callEngine";
import { browserSocketFactory } from "./callSockets";
import { registerCallLauncher, type CallLaunchTarget } from "./callBus";
import { CALL_COPY, type CallKind, type CallRow } from "./callsModel";
import { browserPeerRuntime } from "./peerRuntime";
import { useCalls } from "./useCalls";
import "./calls.css";

type Props = {
  readonly route: AppRoute;
  readonly navigate: Navigate;
};

export function CallsLayer({ route, navigate }: Props) {
  const { api, token, user } = useAuth();
  const meId = user?.id ?? "";
  const messagingEnabled = isWebFeatureEnabled("messaging");
  const identity = useE2eeIdentity(api, Boolean(token && meId), user?.e2eePublicKey ?? "");

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [remoteStream, setRemoteStream] = useState<unknown>(null);

  /** Decline + the ring screen's canned reply, sealed to the peer's key. */
  const sendQuickReply = useCallback(
    async (peerId: string, text: string) => {
      if (!api || !peerId || !text) return;
      try {
        const conversation = await messagingApi.createConversation(api, peerId);
        const conversationId = conversation?.id ?? "";
        if (!conversationId) return;
        const detail = await messagingApi.getConversation(api, conversationId);
        const peerKey = detail?.other?.e2eePublicKey ?? "";
        const sealed = await protectOutgoingBody(
          text,
          { isGroup: detail?.isGroup ?? false, otherId: peerId },
          peerKey,
          identity.identity,
        );
        await messagingApi.sendMessage(api, conversationId, {
          kind: "TEXT",
          body: sealed,
          clientId: newClientId(),
        });
        if (messagingEnabled) navigate({ kind: "conversation", conversationId });
      } catch {
        // A failed quick reply must not resurrect the call the user just declined.
      }
    },
    [api, identity.identity, messagingEnabled, navigate],
  );

  const replyRef = useRef(sendQuickReply);
  replyRef.current = sendQuickReply;

  const engine = useMemo<CallEngine | null>(() => {
    if (!api || !token || !meId) return null;
    return createCallEngine({
      api,
      token,
      meId,
      runtime: browserPeerRuntime(() => audioRef.current),
      clock: browserClock(),
      store: browserStore(),
      sockets: browserSocketFactory(),
      visible: visibilityOf,
      onQuickReply: (peerId, text) => replyRef.current(peerId, text),
    });
    // One engine per session: a new token or a new user is a new engine.
  }, [api, token, meId]);

  const subscribe = useCallback(
    (listener: () => void) => (engine ? engine.subscribe(listener) : () => undefined),
    [engine],
  );
  const getSnapshot = useCallback(() => (engine ? engine.state() : INITIAL_CALL_STATE), [engine]);

  const engineState = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const controller = useCalls({ api: token ? api : null, meId, enabled: Boolean(engine) });
  const invalidate = controller.invalidate;

  useEffect(() => {
    if (!engine) return;
    engine.begin();
    return () => engine.dispose();
  }, [engine]);

  /* A call that just ended drops the history cache at once — the phone bumps
     `callsVersion` from the engine's teardown for the same reason (round 33
     item 2): the new row must not wait for the next visit past the 20 s cache. */
  const phase = engineState.phase;
  const previousPhase = useRef(phase);
  useEffect(() => {
    const was = previousPhase.current;
    previousPhase.current = phase;
    if (was !== "idle" && phase === "idle") invalidate();
  }, [invalidate, phase]);

  useEffect(() => {
    setRemoteStream(engineState.remoteStream?.raw ?? null);
  }, [engineState.remoteStream]);

  useEffect(() => {
    const element = audioRef.current;
    if (!element) return;
    element.srcObject = (remoteStream as MediaStream | null) ?? null;
    if (!remoteStream) {
      setAudioBlocked(false);
      return;
    }
    // A remote track can arrive before any user gesture; the browser then refuses
    // to play it. Say so, and retry on the first interaction instead of leaving a
    // silent call the user cannot explain.
    const attempt = () =>
      element.play().then(
        () => setAudioBlocked(false),
        () => setAudioBlocked(true),
      );
    void attempt();
    const resume = () => void attempt();
    window.addEventListener("pointerdown", resume, { once: true });
    window.addEventListener("keydown", resume, { once: true });
    return () => {
      window.removeEventListener("pointerdown", resume);
      window.removeEventListener("keydown", resume);
    };
  }, [remoteStream]);

  /* The chat header's entry point. Registered only while an engine exists, so a
     build without the flag has no launcher and draws no call buttons. */
  useEffect(() => {
    if (!engine) {
      registerCallLauncher(null);
      return;
    }
    registerCallLauncher((target: CallLaunchTarget, kind: CallKind) => {
      void engine.start(
        {
          id: target.id,
          name: target.name || "KuchuPuchu",
          avatar: target.avatar ?? "",
          online: target.online ?? false,
        },
        kind,
      );
    });
    return () => registerCallLauncher(null);
  }, [engine]);

  const onCallRow = useCallback(
    (row: CallRow) => {
      if (!engine) return;
      if (row.group) {
        // No measured participant cap for a Web mesh yet: refuse with the reason
        // instead of starting a call that silently drops the fourth member.
        controller.announce(CALL_COPY.groupRefused);
        return;
      }
      const peerId = row.incoming ? row.callerId : row.calleeId;
      if (!peerId) return;
      void engine.start(
        {
          id: peerId,
          name: row.other?.displayName || row.other?.username || "KuchuPuchu",
          avatar: row.other?.avatarUrl || row.other?.avatarRef || "",
          online: row.other?.online === true,
        },
        row.kind,
      );
    },
    [controller, engine],
  );

  const onOpenChat = useCallback(
    (peerId: string, conversationId: string) => {
      if (!messagingEnabled) {
        controller.announce(
          "That chat is not open in this build — messaging is behind its own rollout flag.",
        );
        return;
      }
      if (conversationId) {
        navigate({ kind: "conversation", conversationId });
        return;
      }
      if (!peerId || !api) return;
      void messagingApi
        .createConversation(api, peerId)
        .then((conversation) => {
          const id = conversation?.id ?? "";
          if (id) navigate({ kind: "conversation", conversationId: id });
        })
        .catch((cause: unknown) => controller.announce(apiErrorMessage(cause)));
    },
    [api, controller, messagingEnabled, navigate],
  );

  const isCallsTab = route.kind === "section" && route.section === "calls";
  const live = engineState.phase !== "idle" && engineState.phase !== "ended";

  return (
    <>
      {/* One element owns the call's sound. Hidden, mounted for the life of the
          layer, and the element the audio-output picker moves. */}
      <audio
        ref={audioRef}
        className="call-remote-audio"
        autoPlay
        aria-hidden={!live}
        aria-label={
          engineState.peer.name ? `Call audio with ${engineState.peer.name}` : "Call audio"
        }
      />
      {audioBlocked && live ? (
        <p className="call-audio-blocked" role="status">
          This browser paused the call audio. Click anywhere to hear it.
        </p>
      ) : null}

      {engine ? <CallStage engine={engine} state={engineState} /> : null}

      {isCallsTab ? (
        <CallsWorkspace
          controller={controller}
          meId={meId}
          onOpenChat={onOpenChat}
          onCall={onCallRow}
        />
      ) : null}
    </>
  );
}
