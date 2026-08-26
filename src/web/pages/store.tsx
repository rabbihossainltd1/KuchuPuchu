import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { api, RequestError, idempotencyKey } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Avatar, Notice } from "../components/ui";
import { ItemPreview } from "../components/ItemPreview";
import { label } from "../lib/types";
import { STORE_CATALOG } from "../../shared/catalog";
import { PRODUCT_CATEGORIES } from "../../shared/constants";
import "./store.css";

type Product = (typeof STORE_CATALOG)[number];

export function StorePage() {
  const { user, refresh } = useAuth();
  const [category, setCategory] = useState("");
  const [preview, setPreview] = useState<Product | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [buying, setBuying] = useState(false);

  const items = useMemo(
    () => STORE_CATALOG.filter((item) => !category || item.category === category),
    [category],
  );

  async function buy(productId: string) {
    setBuying(true);
    setError("");
    try {
      await api("/api/store/orders", {
        method: "POST",
        body: JSON.stringify({ productId, idempotencyKey: idempotencyKey("store") }),
      });
      setNotice("Added to inventory.");
      setPreview(null);
      await refresh();
    } catch (err) {
      setError(err instanceof RequestError ? err.body.message : "Could not buy.");
    } finally {
      setBuying(false);
    }
  }

  return (
    <div className="store-page">
      <div className="store-top">
        <h1 className="page-title">Store</h1>
        <span className="meta">{user?.wallet.balance ?? 0} coins</span>
      </div>
      <div className="tabs store-tabs">
        <button
          className={category === "" ? "tab active" : "tab"}
          type="button"
          onClick={() => setCategory("")}
        >
          All
        </button>
        {PRODUCT_CATEGORIES.map((item) => (
          <button
            key={item}
            className={category === item ? "tab active" : "tab"}
            type="button"
            onClick={() => setCategory(item)}
          >
            {label(item)}
          </button>
        ))}
      </div>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {notice ? <Notice tone="ok">{notice}</Notice> : null}
      <div className="store-grid compact">
        {items.map((item) => (
          <button
            key={item.id}
            className="store-tile"
            type="button"
            onClick={() => {
              setPreview(item);
              setError("");
            }}
          >
            <ItemPreview imageKey={item.imageKey} name={item.name} />
            <strong>{item.name}</strong>
            <span>{item.priceCoins}</span>
          </button>
        ))}
      </div>

      {preview ? (
        <div className="composer-overlay">
          <div className="composer-sheet wear-sheet">
            <div className="strip-head">
              <h3>{preview.name}</h3>
              <button
                className="icon-plain"
                type="button"
                aria-label="Close"
                onClick={() => setPreview(null)}
              >
                <X size={18} />
              </button>
            </div>
            <WearPreview product={preview} />
            <div className="row" style={{ marginTop: 14 }}>
              <span className="chip">{preview.priceCoins} coins</span>
              <span className={`chip rarity-${preview.rarity}`}>{label(preview.rarity)}</span>
            </div>
            <button className="btn" disabled={buying} onClick={() => void buy(preview.id)}>
              {buying ? "Buying…" : "Buy"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function WearPreview({ product }: { product: Product }) {
  const { user } = useAuth();
  const name = user?.displayName ?? "You";
  const cat = product.category;
  const theme = cat === "themes" ? `art-${product.imageKey}` : "";
  const banner = cat === "banners" ? `art-${product.imageKey}` : "art-banner-dusk";
  const nameClass = cat === "name_styles" ? `art-${product.imageKey} wear-name` : "wear-name";
  const frame = cat === "frames" ? `art-${product.imageKey}` : "";

  return (
    <div className={`wear-card ${theme}`}>
      <div className={`wear-cover ${banner}`} />
      <div className="wear-body">
        <div className={`wear-frame ${frame}`}>
          {frame ? <div className="ring" /> : null}
          <Avatar name={name} url={user?.avatarUrl} large />
        </div>
        <div>
          <strong className={nameClass}>{name}</strong>
          <div className="meta">@{user?.username}</div>
          {cat === "badges" || cat === "profile_decorations" || cat === "limited" ? (
            <div className="wear-badge">
              <ItemPreview imageKey={product.imageKey} name={product.name} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
