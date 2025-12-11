"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BASE_ADJECTIVES, pickDailyAdjectives } from "@/data/adjectives";

export type GuessResult = {
  noun: string;
  score?: number;
  reasoning?: string;
  appealed?: boolean;
  // If this guess was appealed, how many points (if any)
  // were added by the appeal. 0 or undefined means the
  // appeal did not change the score.
  appealDelta?: number;
  isPass?: boolean;
};

export type GameMode = "daily" | "debug-random";

export type GameState = {
  mode: GameMode;
  dateKey: string; // YYYY-MM-DD for daily mode
  adjectives: string[]; // always length 3
  guesses: GuessResult[][]; // [categoryIndex][guessIndex] with 3 categories × 3 guesses
  currentTurnIndex: number; // 0..8
  appealsRemaining: number; // starts at 1
  // For each category, the index (0–2) of the answer the LLM considers
  // the best overall when scores are tied. May be null/undefined if the
  // LLM hasn't given a preference yet.
  favoriteIndices?: (number | null)[];
};

const DAILY_STORAGE_KEY = "off-the-charts-game-v1";

// Bump this version to force a fresh daily puzzle for a given date.
// Changing it changes both:
// - the seed passed into pickDailyAdjectives
// - the dateKey stored in localStorage, so old games are discarded
const DAILY_SEED_VERSION = 2;

function todayKey() {
  const base = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `${base}-v${DAILY_SEED_VERSION}`;
}

function emptyGuesses(): GuessResult[][] {
  return Array.from({ length: 3 }, () =>
    Array.from({ length: 3 }, () => ({ noun: "" })),
  );
}

function createNewDailyState(): GameState {
  const dateKey = todayKey();
  const adjectives = pickDailyAdjectives(dateKey, 3, BASE_ADJECTIVES);
  return {
    mode: "daily",
    dateKey,
    adjectives,
    guesses: emptyGuesses(),
    currentTurnIndex: 0,
    appealsRemaining: 1,
    favoriteIndices: [null, null, null],
  };
}

function reviveState(raw: unknown): GameState | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as any;
  if (!Array.isArray(value.adjectives) || value.adjectives.length !== 3)
    return null;
  if (!Array.isArray(value.guesses)) return null;
  return {
    mode: (value.mode as GameMode) || "daily",
    dateKey: typeof value.dateKey === "string" ? value.dateKey : todayKey(),
    adjectives: value.adjectives as string[],
    guesses: value.guesses as GuessResult[][],
    currentTurnIndex:
      typeof value.currentTurnIndex === "number" ? value.currentTurnIndex : 0,
    appealsRemaining:
      typeof value.appealsRemaining === "number"
        ? value.appealsRemaining
        : 1,
    favoriteIndices:
      Array.isArray(value.favoriteIndices) && value.favoriteIndices.length === 3
        ? (value.favoriteIndices as (number | null)[])
        : [null, null, null],
  };
}

export function useDailyGameState() {
  const [state, setState] = useState<GameState | null>(null);

  // Load from localStorage on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(DAILY_STORAGE_KEY);
      if (stored) {
        const parsed = reviveState(JSON.parse(stored));
        if (parsed && parsed.mode === "daily" && parsed.dateKey === todayKey()) {
          setState(parsed);
          return;
        }
      }
    } catch (e) {
      console.warn("Failed to load Off the Charts state from localStorage", e);
    }

    setState(createNewDailyState());
  }, []);

  // Persist whenever state changes
  useEffect(() => {
    if (!state || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(DAILY_STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn("Failed to persist Off the Charts state", e);
    }
  }, [state]);

  const isLoaded = !!state;

  const currentTurn = useMemo(() => {
    if (!state) return null;
    const idx = Math.min(Math.max(state.currentTurnIndex, 0), 8);
    // Category-major order: 0–2 = category 0, 3–5 = category 1, 6–8 = category 2
    const categoryIndex = Math.floor(idx / 3); // 0,1,2
    const guessIndex = idx % 3; // 0,1,2
    return { idx, adjectiveIndex: categoryIndex, roundIndex: guessIndex };
  }, [state]);

  const isComplete = useMemo(() => {
    if (!state) return false;
    return state.currentTurnIndex >= 9;
  }, [state]);

  const totalScore = useMemo(() => {
    if (!state) return 0;
    // Only the single best answer per category counts.
    return state.guesses.reduce((sum, row) => {
      const best = row.reduce(
        (max, g) => Math.max(max, g.score ?? 0),
        0,
      );
      return sum + best;
    }, 0);
  }, [state]);

  const submitGuessLocally = useCallback(
    (adjectiveIndex: number, roundIndex: number, noun: string) => {
      setState((prev) => {
        if (!prev) return prev;
        const guesses = prev.guesses.map((row, ai) =>
          row.map((g, ri) =>
            ai === adjectiveIndex && ri === roundIndex
              ? { ...g, noun: noun.trim(), isPass: false }
              : g,
          ),
        );
        return { ...prev, guesses };
      });
    },
    [],
  );

  const submitPassLocally = useCallback(
    (adjectiveIndex: number, roundIndex: number) => {
      setState((prev) => {
        if (!prev) return prev;
        const guesses = prev.guesses.map((row, ai) =>
          row.map((g, ri) => {
            if (ai !== adjectiveIndex) return g;
            // The explicit pass the player just chose
            if (ri === roundIndex) {
              return { ...g, noun: g.noun || "PASS", score: 0, isPass: true };
            }
            // Auto-pass any remaining unanswered rounds in this category
            if (ri > roundIndex && !g.noun && !g.isPass) {
              return { ...g, noun: "PASS", score: 0, isPass: true };
            }
            return g;
          }),
        );
        return { ...prev, guesses };
      });
    },
    [],
  );

  const advanceTurn = useCallback(() => {
    setState((prev) => {
      if (!prev) return prev;
      const maxTurns = 9;
      let nextTurnIndex = prev.currentTurnIndex + 1;
      while (nextTurnIndex < maxTurns) {
        const categoryIndex = Math.floor(nextTurnIndex / 3);
        const isLockedCategory = prev.guesses[categoryIndex].some(
          (g) => g.isPass || (g.score ?? 0) >= 10,
        );
        if (isLockedCategory) {
          nextTurnIndex += 3 - (nextTurnIndex % 3); // skip remaining slots in this category
          continue;
        }
        break;
      }
      nextTurnIndex = Math.min(nextTurnIndex, maxTurns);
      return { ...prev, currentTurnIndex: nextTurnIndex };
    });
  }, []);

  const applyScore = useCallback(
    (
      adjectiveIndex: number,
      roundIndex: number,
      score: number,
      reasoning: string,
      favoriteIndexForCategory?: number | null,
    ) => {
      setState((prev) => {
        if (!prev) return prev;
        const guesses = prev.guesses.map((row, ai) =>
          row.map((g, ri) =>
            ai === adjectiveIndex && ri === roundIndex
              ? { ...g, score, reasoning }
              : g,
          ),
        );

        // If a perfect 10/10 was achieved, auto-mark all remaining empty
        // turns in this category as \"Perfect Score Achieved\" so they show
        // up explicitly in the UI, similar to how PASS entries are shown.
        if (score >= 10) {
          const row = guesses[adjectiveIndex];
          for (let i = 0; i < row.length; i++) {
            if (i <= roundIndex) continue;
            const g = row[i];
            if (!g.noun && !g.isPass) {
              row[i] = {
                ...g,
                noun: "Perfect Score Achieved",
                score: 10,
                isPass: true,
              };
            }
          }
        }

        // Update the LLM-preferred best index for this category if provided.
        let favoriteIndices = prev.favoriteIndices ?? [null, null, null];
        if (typeof favoriteIndexForCategory === "number") {
          const idx = Math.max(
            0,
            Math.min(2, Math.floor(favoriteIndexForCategory)),
          );
          favoriteIndices = [...favoriteIndices];
          favoriteIndices[adjectiveIndex] = idx;
        } else {
          // Fallback: if no explicit favorite is provided, keep existing
          // preference, or default to the earliest guess with the highest score.
          const scores = guesses[adjectiveIndex].map((g) => g.score ?? 0);
          const bestScore = Math.max(0, ...scores);
          if (bestScore > 0) {
            const firstBestIndex = scores.findIndex((s) => s === bestScore);
            if (firstBestIndex >= 0) {
              favoriteIndices = [...favoriteIndices];
              if (
                favoriteIndices[adjectiveIndex] == null ||
                favoriteIndices[adjectiveIndex] < 0
              ) {
                favoriteIndices[adjectiveIndex] = firstBestIndex;
              }
            }
          }
        }

        return { ...prev, guesses, favoriteIndices };
      });
    },
    [],
  );

  const applyAppealResult = useCallback(
    (
      adjectiveIndex: number,
      roundIndex: number,
      newScore: number,
      newReasoning: string,
      appealTokenConsumed: boolean,
      favoriteIndexForCategory?: number | null,
    ) => {
      setState((prev) => {
        if (!prev) return prev;
        const previousScore =
          prev.guesses[adjectiveIndex]?.[roundIndex]?.score ?? 0;
        const delta = Math.max(0, (newScore ?? previousScore) - previousScore);

        const guesses = prev.guesses.map((row, ai) =>
          row.map((g, ri) =>
            ai === adjectiveIndex && ri === roundIndex
              ? {
                  ...g,
                  score: newScore,
                  reasoning: newReasoning,
                  appealed: true,
                  appealDelta: delta,
                }
              : g,
          ),
        );
        // Single appeal token for the whole game, always consumed when used.
        const appealsRemaining = Math.max(0, prev.appealsRemaining - 1);

        // Optionally refresh the favorite index for this category after an appeal.
        let favoriteIndices = prev.favoriteIndices ?? [null, null, null];
        if (typeof favoriteIndexForCategory === "number") {
          const idx = Math.max(
            0,
            Math.min(2, Math.floor(favoriteIndexForCategory)),
          );
          favoriteIndices = [...favoriteIndices];
          favoriteIndices[adjectiveIndex] = idx;
        } else {
          // If no explicit favorite is provided, keep the existing preference
          // and let numeric scores handle "best" in the UI when no tie exists.
          favoriteIndices = [...favoriteIndices];
        }

        return { ...prev, guesses, appealsRemaining, favoriteIndices };
      });
    },
    [],
  );

  const resetDaily = useCallback(() => {
    setState(createNewDailyState());
  }, []);

  const forceRandomDebugGame = useCallback(() => {
    const adjectives = [...BASE_ADJECTIVES]
      .sort(() => Math.random() - 0.5)
      .slice(0, 3);
    setState({
      mode: "debug-random",
      dateKey: todayKey(),
      adjectives,
      guesses: emptyGuesses(),
      currentTurnIndex: 0,
      appealsRemaining: 1,
    });
  }, []);

  return {
    state,
    isLoaded,
    isComplete,
    currentTurn,
    totalScore,
    submitGuessLocally,
    submitPassLocally,
    advanceTurn,
    applyScore,
    applyAppealResult,
    resetDaily,
    forceRandomDebugGame,
  } as const;
}
