export function ItemPreview({ imageKey, name }: { imageKey: string; name: string }) {
  const initial = name.trim().slice(0, 1).toUpperCase() || "K";
  const word = name.split(" ")[0] ?? name;
  const isFrame = imageKey.startsWith("frame");
  const isSeal =
    imageKey.startsWith("badge") ||
    imageKey === "deco-seal" ||
    imageKey === "deco-pin" ||
    imageKey === "deco-crest";
  const isBar = imageKey === "deco-ribbon" || imageKey === "deco-corner";

  return (
    <div className={`item-preview art-${imageKey}`} aria-hidden>
      {isFrame ? <div className="ring" /> : null}
      {isSeal ? <div className="seal">{initial}</div> : null}
      {isBar ? <div className="bar" /> : null}
      {!isFrame && !isSeal && !isBar ? <span className="mark">{word}</span> : null}
    </div>
  );
}
