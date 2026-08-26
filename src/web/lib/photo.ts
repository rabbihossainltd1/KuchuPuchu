export async function readPhoto(file: File, max = 540, limit = 700000) {
  const bitmap = typeof createImageBitmap === "function" ? await createImageBitmap(file) : null;
  if (!bitmap) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Could not read that photo."));
      reader.onload = () => resolve(String(reader.result || ""));
      reader.readAsDataURL(file);
    });
  }
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not read that photo.");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  let quality = 0.62;
  let data = canvas.toDataURL("image/jpeg", quality);
  while (data.length > limit && quality > 0.35) {
    quality -= 0.08;
    data = canvas.toDataURL("image/jpeg", quality);
  }
  return data;
}
