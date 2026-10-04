import { getOutputSize, type AspectFormat } from "./output-format";

/** Split thumbnail text into at most `maxLines` lines of ~maxChars. Pure. */
export function wrapThumbnailText(text: string, maxChars = 16, maxLines = 3): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > maxChars && cur) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, maxLines);
}

/** Draw the current video frame, framed like the export, with optional bold text. */
export function drawThumbnailFrame(
  video: HTMLVideoElement,
  opts: { format: AspectFormat; x: number; flip: boolean; text?: string },
): string | null {
  const { width: outW, height: outH } = getOutputSize(opts.format, "standard");
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const vw = video.videoWidth || 1280;
  const vh = video.videoHeight || 720;
  const scale = Math.max(outW / vw, outH / vh);
  const sw = outW / scale;
  const sh = outH / scale;
  const cx = Math.min(Math.max(opts.x * vw, sw / 2), vw - sw / 2);
  ctx.save();
  if (opts.flip) {
    ctx.translate(outW, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, cx - sw / 2, (vh - sh) / 2, sw, sh, 0, 0, outW, outH);
  ctx.restore();

  const lines = wrapThumbnailText((opts.text ?? "").toUpperCase());
  if (lines.length) {
    const size = Math.round(Math.min(outW, outH) * 0.11);
    ctx.font = `900 ${size}px Anton, Impact, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(4, size * 0.14);
    ctx.strokeStyle = "black";
    ctx.fillStyle = "white";
    const top = outH * 0.5 - ((lines.length - 1) * size * 1.1) / 2;
    lines.forEach((l, i) => {
      const y = top + i * size * 1.1;
      ctx.strokeText(l, outW / 2, y, outW * 0.9);
      ctx.fillText(l, outW / 2, y, outW * 0.9);
    });
  }
  return canvas.toDataURL("image/jpeg", 0.8);
}
