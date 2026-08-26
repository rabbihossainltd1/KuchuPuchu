function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that photo."));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not read that photo."));
    img.src = src;
  });
}

export async function readPhoto(file: File, max = 1280, limit = 380000) {
  let width = 0;
  let height = 0;
  let source: CanvasImageSource | null = null;
  try {
    if (typeof createImageBitmap === "function") {
      const bitmap = await createImageBitmap(file);
      width = bitmap.width;
      height = bitmap.height;
      source = bitmap;
    }
  } catch {
    source = null;
  }
  if (!source) {
    const img = await loadImage(await fileToDataUrl(file));
    width = img.naturalWidth || img.width;
    height = img.naturalHeight || img.height;
    source = img;
  }
  const canvas = document.createElement("canvas");
  let scale = Math.min(1, max / Math.max(width, height, 1));
  let quality = 0.88;
  let data = "";
  for (let i = 0; i < 8; i += 1) {
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not read that photo.");
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    data = canvas.toDataURL("image/jpeg", quality);
    if (data.length <= limit) return data;
    if (quality > 0.55) quality -= 0.08;
    else scale *= 0.85;
  }
  if (!data.startsWith("data:image")) throw new Error("Could not read that photo.");
  return data;
}

export async function savePhoto(src: string) {
  const name = `kuchupuchu-${Date.now()}.jpg`;
  try {
    const res = await fetch(src);
    const blob = await res.blob();
    const file = new File([blob], name, { type: blob.type || "image/jpeg" });
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: "Photo" });
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch {
    const link = document.createElement("a");
    link.href = src;
    link.download = name;
    link.click();
  }
}
