// Image d'un profil : fichier choisi par l'utilisateur, recadré en carré et réduit, gardé en
// data URL (quelques Ko dans state.json : rien à copier ni à retrouver sur le disque).

/** Côté de l'image enregistrée, en pixels (assez pour l'avatar de 46 px en haute densité). */
export const AVATAR_SIZE = 128;

/** Au-delà, une image qu'on ne peut pas réduire (pas de canvas) est refusée. */
const MAX_RAW = 256 * 1024;

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject("image_unreadable");
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject("image_unreadable");
    img.src = src;
  });
}

/** Image carrée (recadrée au centre) de `size` px, en WebP (transparence gardée ; PNG si le
 *  moteur ne sait pas l'encoder, WebKitGTK par exemple) ; erreur `image_unreadable`. */
export async function squareImage(file: Blob, size = AVATAR_SIZE): Promise<string> {
  if (!file.type.startsWith("image/")) throw "image_unreadable";
  const raw = await readAsDataUrl(file);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    // Pas de canvas (environnement de test) : l'image telle quelle, si elle reste petite.
    if (raw.length > MAX_RAW) throw "image_unreadable";
    return raw;
  }
  const img = await loadImage(raw);
  const w = img.naturalWidth || img.width || size;
  const h = img.naturalHeight || img.height || size;
  const side = Math.min(w, h);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, size, size);
  return canvas.toDataURL("image/webp", 0.9);
}
