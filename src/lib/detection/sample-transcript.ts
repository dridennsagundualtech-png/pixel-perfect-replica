import type { TranscriptionResult, TranscriptSegment } from "./transcript";

/**
 * Development sample transcript.
 *
 * Hand-written test data for exercising candidate generation, rules, scoring
 * and ranking. It is NOT a transcript of any uploaded video and must never be
 * stored on a project or presented as real analysis.
 */

export const SAMPLE_TRANSCRIPT_LABEL = "Development sample transcript";

const LINES: [number, number, string][] = [
  [0.0, 4.2, "Welcome back to the show, today we're talking about building habits."],
  [4.6, 9.8, "Why do most people fail at their new year's resolutions within two weeks?"],
  [10.1, 15.4, "The truth is, it's not about willpower at all, it's about your environment."],
  [15.8, 21.0, "When I was twenty-five I tried to wake up at 5am for an entire year."],
  [21.3, 26.9, "I failed every single week, and honestly I felt like a fraud."],
  [27.2, 32.8, "Then I moved my alarm clock across the room and put my running shoes next to it."],
  [33.0, 38.6, "That one change did more than every motivational video I had ever watched."],
  [38.9, 44.5, "So the lesson is simple: design your space so the good choice is the easy choice."],
  [48.2, 51.0, "Um, so, uh, yeah, like, anyway."],
  [51.4, 56.8, "Here's the thing you need to know about habit stacking."],
  [57.1, 62.5, "You attach a new habit to something you already do every day without thinking."],
  [62.8, 68.3, "For example, after I pour my coffee, I write down three priorities for the day."],
  [68.6, 73.9, "It takes forty seconds, and it gives the whole morning a direction."],
  [
    74.2,
    79.8,
    "Researchers found that people who plan when and where they act are far more consistent.",
  ],
  [80.1, 85.0, "That's why a vague goal like getting fit almost never works."],
  [
    85.4,
    90.2,
    "Have you ever wondered why the first week feels so easy and the third week feels impossible?",
  ],
  [
    90.5,
    96.1,
    "Surprisingly, it's because the novelty wears off, and nobody talks about that part.",
  ],
  [96.4, 101.8, "Motivation is a spark, but systems are the engine that keeps you moving"],
  [102.0, 106.5, "when the spark is gone and you just don't feel like it."],
  [106.8, 112.2, "I remember the night I almost quit; I was exhausted and I cried in the car."],
  [112.5, 118.0, "But I showed up for ten minutes anyway, and that changed everything for me."],
  [118.3, 123.4, "At the end of the day, consistency beats intensity every single time."],
  [127.9, 132.6, "Okay, let's take a quick break and we'll be right back."],
];

export const SAMPLE_TRANSCRIPT_SEGMENTS: TranscriptSegment[] = LINES.map(
  ([startSec, endSec, text], i) => ({
    id: `sample-${i + 1}`,
    startSec,
    endSec,
    text,
    speaker: "Host",
  }),
);

export const SAMPLE_TRANSCRIPT: TranscriptionResult = {
  segments: SAMPLE_TRANSCRIPT_SEGMENTS,
  language: "en",
  durationSec: 133,
  source: "dev-sample",
};
