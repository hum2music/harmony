import type { TempoCandidate } from "@hum2music/core";
import type { TimedNote } from "./timed-note.ts";

export interface TempoEstimationOptions {
  minIntervalMs?: number;
  maxIntervalMs?: number;
  maxCandidates?: number;
}

/**
 * Builds a histogram of inter-onset intervals (read as implied quarter-note
 * BPM) and returns the most frequent values as ranked candidates. Half/double
 * tempo relationships are flagged rather than collapsed, per PRD §7.1.
 */
export function estimateTempo(notes: TimedNote[], options: TempoEstimationOptions = {}): TempoCandidate[] {
  const minIntervalMs = options.minIntervalMs ?? 100;
  const maxIntervalMs = options.maxIntervalMs ?? 2000;
  const maxCandidates = options.maxCandidates ?? 5;

  const onsets = notes.map((note) => note.startMs).sort((a, b) => a - b);
  const intervals: number[] = [];
  for (let i = 1; i < onsets.length; i++) {
    const interval = onsets[i] - onsets[i - 1];
    if (interval >= minIntervalMs && interval <= maxIntervalMs) intervals.push(interval);
  }
  if (intervals.length === 0) return [];

  const bpmCounts = new Map<number, number>();
  for (const interval of intervals) {
    const bpm = Math.round(60000 / interval);
    bpmCounts.set(bpm, (bpmCounts.get(bpm) ?? 0) + 1);
  }

  const total = intervals.length;
  const candidates: TempoCandidate[] = [];
  for (const [bpm, count] of [...bpmCounts.entries()].sort((a, b) => b[1] - a[1])) {
    if (candidates.some((candidate) => isCloseBpm(candidate.bpm, bpm, 4))) continue;
    candidates.push({ bpm, confidence: count / total });
    if (candidates.length >= maxCandidates) break;
  }

  linkHalfAndDoubleTempoCandidates(candidates);
  return candidates;
}

function isCloseBpm(a: number, b: number, toleranceBpm: number): boolean {
  return Math.abs(a - b) <= toleranceBpm;
}

function linkHalfAndDoubleTempoCandidates(candidates: TempoCandidate[]): void {
  for (const candidate of candidates) {
    const strongerRelated = candidates.find(
      (other) =>
        other !== candidate &&
        other.confidence >= candidate.confidence &&
        (isCloseBpm(other.bpm, candidate.bpm * 2, other.bpm * 0.05) ||
          isCloseBpm(other.bpm, candidate.bpm / 2, other.bpm * 0.05)),
    );
    if (strongerRelated) candidate.isHalfOrDoubleOf = strongerRelated.bpm;
  }
}

/** A half-tempo candidate must retain at least this fraction of the fastest candidate's confidence to be treated as the real tactus, not noise. */
const MIN_HALF_TEMPO_CONFIDENCE_RATIO = 0.3;

/**
 * The raw histogram's most frequent interval is usually the shortest
 * commonly-recurring note value (eighth/sixteenth notes), not the beat a
 * listener would tap their foot to - a real melody has more subdivision-
 * level onsets than beat-level ones by construction. Folds the fastest
 * candidate down through any still-plausible half-tempo relative(s) before
 * it's used as the song's actual tempo; `tempoCandidates` itself is left in
 * raw-frequency order so callers still see the full, uncollapsed histogram.
 */
export function selectPreferredTempo(candidates: TempoCandidate[]): number | undefined {
  if (candidates.length === 0) return undefined;

  let preferred = candidates[0];
  for (;;) {
    const half = candidates.find(
      (other) =>
        other !== preferred &&
        isCloseBpm(other.bpm, preferred.bpm / 2, preferred.bpm * 0.05) &&
        other.confidence >= preferred.confidence * MIN_HALF_TEMPO_CONFIDENCE_RATIO,
    );
    if (!half) return preferred.bpm;
    preferred = half;
  }
}
