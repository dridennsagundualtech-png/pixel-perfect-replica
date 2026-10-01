import type { TranscriptSegment } from "./transcript";

/**
 * Per-segment text features, computed once per transcript and reused by every
 * candidate window. All detectors are simple keyword/punctuation heuristics —
 * they are deterministic but not "understanding", and are labelled as such.
 */

export interface PreparedSegment extends TranscriptSegment {
  index: number;
  tokens: string[];
  wordCount: number;
  fillerCount: number;
  startsSentence: boolean;
  endsSentence: boolean;
  question: boolean;
  strongStatement: boolean;
  directAddress: boolean;
  surprising: boolean;
  payoff: boolean;
  conclusion: boolean;
  educational: boolean;
  funny: boolean;
  emotional: boolean;
  storytelling: boolean;
}

const FILLER_PATTERN =
  /\b(?:um+|uh+|erm?|hmm+|basically|literally|you know|i mean|sort of|kind of)\b|(?:^|,\s*)like(?=\s*,)/gi;

const QUESTION_START =
  /(?:^|[.!?]\s+)(?:what|why|how|when|where|who|which|can|could|would|should|do|does|did|is|are|have|has|will|ever wonder)\b[^.!]*$/i;
const STRONG =
  /\b(?:the truth is|here'?s the thing|you need to|you have to|never|always|the biggest|the most important|the key is|the problem is|the reason is|stop|nobody|everyone|the only|number one|must)\b/i;
const DIRECT = /\b(?:you|your|you're|you've|you'll|yourself)\b/i;
const SURPRISING =
  /\b(?:surprising(?:ly)?|turns out|believe it or not|shocking|nobody (?:talks|tells|knows)|most people (?:don'?t|think)|the secret|myth|wrong about|actually|counterintuitive|no one expects)\b/i;
const PAYOFF =
  /\b(?:that'?s why|which means|the lesson|the result|in the end|turns out|that'?s how|the answer is|what i learned|so the point|the takeaway|and it worked|that changed)\b/i;
const CONCLUSION =
  /(?:^|\b)(?:so|that'?s why|in the end|bottom line|ultimately|which is why|and that'?s|the point is|at the end of the day|in short|long story short|that'?s the)\b/i;
const EDUCATIONAL =
  /\b(?:how to|step|tip|here'?s how|the way to|learn|for example|because|framework|method|strategy|first|second|third|\d+\s*(?:%|percent|times|steps|ways))\b/i;
const FUNNY =
  /\b(?:haha+|lol|joke|funny|hilarious|laugh(?:s|ing|ed)?)\b|\[(?:laughter|laughs)\]|\((?:laughs|laughter)\)/i;
const EMOTIONAL =
  /\b(?:love|hate|scared|afraid|cried|crying|tears|heart|proud|angry|devastated|terrified|grateful|broke(?:n)? down|painful|amazing|incredible)\b|!/i;
const STORY =
  /\b(?:when i was|one day|i remember|years ago|back then|then i|story|so i|i was|we were|that night|the first time)\b/i;
const SENTENCE_END = /[.!?؟。！？]["'”’)\]]*$/;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, ""))
    .filter(Boolean);
}

export function prepareSegments(segments: TranscriptSegment[]): PreparedSegment[] {
  const prepared: PreparedSegment[] = [];
  segments.forEach((segment, index) => {
    const text = segment.text;
    const tokens = tokenize(text);
    const prev = prepared[index - 1];
    const gapFromPrev = prev ? segment.startSec - prev.endSec : Infinity;
    prepared.push({
      ...segment,
      index,
      tokens,
      wordCount: tokens.length,
      fillerCount: text.match(FILLER_PATTERN)?.length ?? 0,
      startsSentence: !prev || prev.endsSentence || gapFromPrev >= 1,
      endsSentence: SENTENCE_END.test(text),
      question: /[?？]/.test(text) || QUESTION_START.test(text),
      strongStatement: STRONG.test(text),
      directAddress: DIRECT.test(text),
      surprising: SURPRISING.test(text),
      payoff: PAYOFF.test(text),
      conclusion: CONCLUSION.test(text),
      educational: EDUCATIONAL.test(text),
      funny: FUNNY.test(text),
      emotional: EMOTIONAL.test(text),
      storytelling: STORY.test(text),
    });
  });
  return prepared;
}
