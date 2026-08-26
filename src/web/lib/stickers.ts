export const STICKERS = [
  { id: "fire", name: "Fire", src: "/stickers/fire.png" },
  { id: "heart", name: "Heart", src: "/stickers/heart.png" },
  { id: "like", name: "Like", src: "/stickers/like.png" },
  { id: "gg", name: "GG", src: "/stickers/gg.png" },
  { id: "cry", name: "Cry", src: "/stickers/cry.png" },
  { id: "rage", name: "Rage", src: "/stickers/rage.png" },
  { id: "star", name: "Star", src: "/stickers/star.png" },
  { id: "party", name: "Party", src: "/stickers/party.png" },
  { id: "love", name: "Love", src: "/stickers/love.png" },
  { id: "clutch", name: "Clutch", src: "/stickers/clutch.png" },
] as const;

export function stickerSrc(id: string) {
  return STICKERS.find((item) => item.id === id)?.src ?? null;
}
