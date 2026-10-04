import type { TranscriptSegment } from "../src/lib/detection/transcript";

export const seg = (id: string, start: number, end: number, text: string): TranscriptSegment => ({
  id,
  startSec: start,
  endSec: end,
  text,
});

/** n contiguous 6s sentences. */
export function sentences(texts: string[], len = 6, offset = 0): TranscriptSegment[] {
  return texts.map((t, i) =>
    seg(`s${offset + i}`, offset * len + i * len, offset * len + i * len + len, t),
  );
}

export const PLAIN = [
  "We walked along the river in the morning.",
  "The water was calm and the air felt cool.",
  "A few boats moved slowly past the old bridge.",
  "Later we stopped at a small cafe near the park.",
  "Then we took the train back into the city.",
];

export const RICH = [
  "Why do most people never finish their projects?",
  "The truth is you need a much smaller first step.",
  "I remember starting with ten minutes a day.",
  "It felt tiny but I kept showing up every morning.",
  "That's why the lesson is to start small and stay consistent.",
];

export const NOW = () => "1970-01-01T00:00:00.000Z";
