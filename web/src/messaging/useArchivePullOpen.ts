import { useCallback, useEffect, useRef, useState, type MouseEvent, type RefObject } from "react";

const PULL_THRESHOLD = 90;
const MAX_PULL = PULL_THRESHOLD * 1.6;
const HOLD_MS = 2_000;
const HOLD_TICK_MS = 50;
const CLICK_DRAG_PX = 8;
const CLICK_SUPPRESS_MS = 350;

type PullPhase = "idle" | "holding" | "opening";
type PullSource = "list" | "header";

type TouchSession = {
  identifier: number;
  startX: number;
  startY: number;
  source: PullSource;
  row: Element | null;
  didMove: boolean;
  armed: boolean;
};

type ClickSuppression = { row: Element; until: number };

type Options = {
  hostRef: RefObject<HTMLElement | null>;
  listRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  onOpen: () => void;
};

/**
 * Android's chat-list archive gesture, adapted to Web touch input: at the top
 * of the list, pull 90 CSS px and hold for two seconds. The touch observer only
 * prevents the browser's overscroll while pulling down at that top edge; upward
 * scrolling, row actions and the existing Archived button remain untouched.
 */
export function useArchivePullOpen({ hostRef, listRef, enabled, onOpen }: Options) {
  const [pull, setPull] = useState(0);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<PullPhase>("idle");

  const pullRef = useRef(0);
  const phaseRef = useRef<PullPhase>("idle");
  const sessionRef = useRef<TouchSession | null>(null);
  const enabledRef = useRef(enabled);
  const onOpenRef = useRef(onOpen);
  const holdStartedAtRef = useRef(0);
  const holdIntervalRef = useRef<number | null>(null);
  const openTimeoutRef = useRef<number | null>(null);
  const clickSuppressionRef = useRef<ClickSuppression | null>(null);

  enabledRef.current = enabled;
  onOpenRef.current = onOpen;

  const updatePull = useCallback((value: number) => {
    const next = Math.max(0, Math.min(MAX_PULL, value));
    pullRef.current = next;
    setPull(next);
  }, []);

  const stopHold = useCallback(() => {
    if (holdIntervalRef.current !== null) {
      window.clearInterval(holdIntervalRef.current);
      holdIntervalRef.current = null;
    }
    holdStartedAtRef.current = 0;
    if (phaseRef.current === "holding") {
      phaseRef.current = "idle";
      setPhase("idle");
      setProgress(0);
    }
  }, []);

  const reset = useCallback(() => {
    sessionRef.current = null;
    stopHold();
    if (openTimeoutRef.current !== null) {
      window.clearTimeout(openTimeoutRef.current);
      openTimeoutRef.current = null;
    }
    phaseRef.current = "idle";
    setPhase("idle");
    setProgress(0);
    updatePull(0);
  }, [stopHold, updatePull]);

  useEffect(() => {
    if (!enabled) reset();
  }, [enabled, reset]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const startHold = () => {
      if (phaseRef.current !== "idle") return;
      phaseRef.current = "holding";
      setPhase("holding");
      setProgress(0);
      holdStartedAtRef.current = window.performance.now();
      holdIntervalRef.current = window.setInterval(() => {
        if (phaseRef.current !== "holding") return;
        const elapsed = window.performance.now() - holdStartedAtRef.current;
        const nextProgress = Math.min(1, elapsed / HOLD_MS);
        setProgress(nextProgress);
        if (nextProgress < 1) return;

        if (holdIntervalRef.current !== null) {
          window.clearInterval(holdIntervalRef.current);
          holdIntervalRef.current = null;
        }
        phaseRef.current = "opening";
        setPhase("opening");
        updatePull(PULL_THRESHOLD);
        setProgress(1);
        try {
          window.navigator.vibrate?.(18);
        } catch {
          // Vibration is best-effort; the visual confirmation is sufficient.
        }
        openTimeoutRef.current = window.setTimeout(() => {
          openTimeoutRef.current = null;
          sessionRef.current = null;
          phaseRef.current = "idle";
          setPhase("idle");
          setProgress(0);
          updatePull(0);
          onOpenRef.current();
        }, 450);
      }, HOLD_TICK_MS);
    };

    const onTouchStart = (event: TouchEvent) => {
      if (!enabledRef.current || event.touches.length !== 1 || phaseRef.current === "opening") {
        return;
      }
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (
        target.closest(
          "button, input, textarea, select, [contenteditable='true'], [role='button'], [role='dialog']",
        )
      ) {
        return;
      }

      const source: PullSource | null = target.closest(".list-header, .search-field")
        ? "header"
        : target.closest(".list-content")
          ? "list"
          : null;
      if (!source) return;

      const list = listRef.current;
      if (source === "list" && (!list || list.scrollTop > 0.5)) return;

      const touch = event.touches[0];
      if (!touch) return;
      sessionRef.current = {
        identifier: touch.identifier,
        startX: touch.clientX,
        startY: touch.clientY,
        source,
        row: target.closest(".conversation-row"),
        didMove: false,
        armed: source === "header",
      };
    };

    const onTouchMove = (event: TouchEvent) => {
      const session = sessionRef.current;
      if (!enabledRef.current || !session || phaseRef.current === "opening") return;
      const touch = Array.from(event.touches).find(
        (candidate) => candidate.identifier === session.identifier,
      );
      if (!touch) return;

      const deltaX = touch.clientX - session.startX;
      const deltaY = touch.clientY - session.startY;
      if (Math.abs(deltaX) > 14 && Math.abs(deltaX) > Math.abs(deltaY) * 1.25) {
        reset();
        return;
      }

      if (deltaY <= 0) {
        session.didMove ||= Math.abs(deltaY) >= CLICK_DRAG_PX;
        updatePull(0);
        stopHold();
        return;
      }

      if (session.source === "list" && !session.armed) {
        const list = listRef.current;
        if (!list || list.scrollTop > 0.5) {
          reset();
          return;
        }
        session.armed = true;
      }

      session.didMove ||= deltaY >= CLICK_DRAG_PX;
      if (deltaY > 2 && event.cancelable) event.preventDefault();
      updatePull(deltaY);
      if (deltaY >= PULL_THRESHOLD) startHold();
      else stopHold();
    };

    const finishTouch = (event: TouchEvent) => {
      const session = sessionRef.current;
      if (!session) return;
      const ended = Array.from(event.changedTouches).some(
        (touch) => touch.identifier === session.identifier,
      );
      if (!ended) return;

      if (session.didMove && session.row) {
        clickSuppressionRef.current = { row: session.row, until: Date.now() + CLICK_SUPPRESS_MS };
      }
      sessionRef.current = null;
      if (phaseRef.current !== "opening") {
        stopHold();
        updatePull(0);
      }
    };

    const onTouchCancel = (event: TouchEvent) => finishTouch(event);

    host.addEventListener("touchstart", onTouchStart, { passive: true });
    host.addEventListener("touchmove", onTouchMove, { passive: false });
    host.addEventListener("touchend", finishTouch, { passive: true });
    host.addEventListener("touchcancel", onTouchCancel, { passive: true });

    return () => {
      host.removeEventListener("touchstart", onTouchStart);
      host.removeEventListener("touchmove", onTouchMove);
      host.removeEventListener("touchend", finishTouch);
      host.removeEventListener("touchcancel", onTouchCancel);
      reset();
    };
  }, [hostRef, listRef, reset, stopHold, updatePull]);

  const onClickCapture = useCallback((event: MouseEvent<HTMLElement>) => {
    const suppression = clickSuppressionRef.current;
    if (!suppression) return;
    if (Date.now() > suppression.until) {
      clickSuppressionRef.current = null;
      return;
    }
    const target = event.target;
    if (!(target instanceof Element) || target.closest(".conversation-row") !== suppression.row) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    clickSuppressionRef.current = null;
  }, []);

  return { pull, progress, phase, onClickCapture };
}
