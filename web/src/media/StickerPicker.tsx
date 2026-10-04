/**
 * The sticker sheet.
 *
 * The catalog is generated from Android's `StickerSheet.kt` (see
 * `scripts/generate-web-stickers.ts`), so the packs, their order and every
 * glyph match the phone. A sticker sends as `kind: "STICKER"` with the glyph in
 * `body` — the same shape `sendText(content, "STICKER")` produces on Android —
 * and is sealed in a personal chat exactly like a text body.
 *
 * 1,150 glyph buttons cannot all sit in the tab order, so the grid uses a
 * roving tabindex: Tab reaches the sheet and the pack tabs, arrow keys move
 * inside the grid, Enter picks.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { STICKER_PACKS } from "../media/stickerPacks";

const RECENTS_KEY = "kp.sticker.recents";
const RECENTS_CAP = 24;

export type StickerPickerProps = {
  onPick: (glyph: string) => void;
  onClose: () => void;
  /** Announced when a sticker is sent, so the sheet is not a silent action. */
  onAnnounce?: (message: string) => void;
};

function readRecents(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string").slice(0, RECENTS_CAP);
  } catch {
    return [];
  }
}

function writeRecents(glyphs: readonly string[]): void {
  try {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(glyphs.slice(0, RECENTS_CAP)));
  } catch {
    // Private mode or a full quota: recents are a convenience, not a feature
    // worth surfacing an error for.
  }
}

export function StickerPicker({ onPick, onClose, onAnnounce }: StickerPickerProps) {
  const [activePack, setActivePack] = useState(0);
  const [recents, setRecents] = useState<readonly string[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    setRecents(readRecents());
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pack = STICKER_PACKS[activePack];
  const glyphs = useMemo<readonly string[]>(() => {
    if (activePack === -1) return recents;
    return pack?.glyphs ?? [];
  }, [activePack, pack, recents]);

  const pick = useCallback(
    (glyph: string) => {
      const next = [glyph, ...recents.filter((item) => item !== glyph)].slice(0, RECENTS_CAP);
      setRecents(next);
      writeRecents(next);
      onPick(glyph);
      onAnnounce?.(`Sticker ${glyph} sent.`);
    },
    [onAnnounce, onPick, recents],
  );

  // Reset the roving index whenever the visible glyph set changes.
  useEffect(() => {
    setActiveIndex(0);
  }, [activePack]);

  const focusGlyph = useCallback(
    (index: number) => {
      if (!glyphs.length) return;
      const wrapped = ((index % glyphs.length) + glyphs.length) % glyphs.length;
      setActiveIndex(wrapped);
      const node = gridRef.current?.querySelector<HTMLButtonElement>(
        `[data-glyph-index="${wrapped}"]`,
      );
      node?.focus();
    },
    [glyphs.length],
  );

  const onGridKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const columns = 8;
      switch (event.key) {
        case "ArrowRight":
          event.preventDefault();
          focusGlyph(activeIndex + 1);
          break;
        case "ArrowLeft":
          event.preventDefault();
          focusGlyph(activeIndex - 1);
          break;
        case "ArrowDown":
          event.preventDefault();
          focusGlyph(activeIndex + columns);
          break;
        case "ArrowUp":
          event.preventDefault();
          focusGlyph(activeIndex - columns);
          break;
        case "Home":
          event.preventDefault();
          focusGlyph(0);
          break;
        case "End":
          event.preventDefault();
          focusGlyph(glyphs.length - 1);
          break;
        default:
          break;
      }
    },
    [activeIndex, focusGlyph, glyphs.length],
  );

  const tabs = useMemo(() => {
    const list: { index: number; label: string }[] = [];
    if (recents.length) list.push({ index: -1, label: "Recently used" });
    STICKER_PACKS.forEach((item, index) => list.push({ index, label: item.name }));
    return list;
  }, [recents.length]);

  if (!glyphs.length) {
    return (
      <div className="sticker-picker" role="group" aria-label="Stickers">
        <p className="sticker-picker__empty">
          No stickers used yet. Pick a pack below to send your first one.
        </p>
        <div className="sticker-picker__tabs" role="tablist" aria-label="Sticker packs">
          {STICKER_PACKS.map((item, index) => (
            <button
              key={item.name}
              type="button"
              role="tab"
              aria-selected={activePack === index}
              onClick={() => setActivePack(index)}
            >
              {item.name}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="sticker-picker" role="group" aria-label="Stickers">
      <div className="sticker-picker__head">
        <span className="sticker-picker__count">
          {pack ? `${pack.name} · ${pack.glyphs.length}` : `Recently used · ${glyphs.length}`}
        </span>
        <button type="button" className="text-button" onClick={onClose} aria-label="Close stickers">
          Close
        </button>
      </div>

      <div className="sticker-picker__tabs" role="tablist" aria-label="Sticker packs">
        {tabs.map((tab, position) => (
          <button
            key={`${tab.index}-${tab.label}`}
            ref={(node) => {
              tabRefs.current[position] = node;
            }}
            type="button"
            role="tab"
            id={`sticker-tab-${tab.index}`}
            aria-selected={activePack === tab.index}
            tabIndex={activePack === tab.index ? 0 : -1}
            onClick={() => setActivePack(tab.index)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
              event.preventDefault();
              const delta = event.key === "ArrowRight" ? 1 : -1;
              const next = (position + delta + tabs.length) % tabs.length;
              const target = tabs[next];
              if (!target) return;
              setActivePack(target.index);
              tabRefs.current[next]?.focus();
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div
        className="sticker-picker__grid"
        ref={gridRef}
        role="tabpanel"
        aria-labelledby={`sticker-tab-${activePack}`}
        onKeyDown={onGridKeyDown}
      >
        {glyphs.map((glyph, index) => (
          <button
            key={`${glyph}-${index}`}
            type="button"
            data-glyph-index={index}
            className="sticker-picker__cell"
            tabIndex={index === activeIndex ? 0 : -1}
            aria-label={`Send sticker ${glyph}`}
            title={`Send sticker ${glyph}`}
            onClick={() => pick(glyph)}
          >
            <span aria-hidden="true">{glyph}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
