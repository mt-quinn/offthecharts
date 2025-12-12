"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BASE_ADJECTIVES, pickDailyAdjectives } from "@/data/adjectives";

export type GuessResult = {
  noun: string;
  scores?: [number, number]; // [score1, score2] for the two adjectives
  reasonings?: [string, string]; // [reasoning1, reasoning2] - one explanation per adjective
  appealed?: boolean;
  // If this guess was appealed, how many points (if any)
  // were added by the appeal. 0 or undefined means the
  // appeal did not change the scores.
  appealDelta?: [number, number]; // [delta1, delta2]
  isPass?: boolean;
};

export type GameMode = "daily" | "debug-random";

export type GameState = {
  mode: GameMode;
  dateKey: string; // YYYY-MM-DD for daily mode
  adjectives: [string, string]; // exactly 2 adjectives
  guesses: GuessResult[]; // 5 guesses for the single combined category
  currentTurnIndex: number; // 0..4
  appealsRemaining: number; // starts at 1
};

const DAILY_STORAGE_KEY = "off-the-charts-game-v2";

// Bump this version to force a fresh daily puzzle for a given date.
// Changing it changes both:
// - the seed passed into pickDailyAdjectives
// - the dateKey stored in localStorage, so old games are discarded
const DAILY_SEED_VERSION = 4;

function todayKey() {
  const base = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `${base}-v${DAILY_SEED_VERSION}`;
}

function emptyGuesses(): GuessResult[] {
  return Array.from({ length: 5 }, () => ({ noun: "" }));
}

function createNewDailyState(): GameState {
  const dateKey = todayKey();
  const selected = pickDailyAdjectives(dateKey, 2, BASE_ADJECTIVES);
  if (selected.length !== 2) {
    throw new Error("Expected exactly 2 adjectives");
  }
  return {
    mode: "daily",
    dateKey,
    adjectives: [selected[0], selected[1]],
    guesses: emptyGuesses(),
    currentTurnIndex: 0,
    appealsRemaining: 1,
  };
}

function reviveState(raw: unknown): GameState | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as any;
  // Support both old format (3 adjectives) and new format (2 adjectives)
  if (!Array.isArray(value.adjectives)) return null;
  if (value.adjectives.length === 2) {
    // New format
    if (!Array.isArray(value.guesses)) return null;
    return {
      mode: (value.mode as GameMode) || "daily",
      dateKey: typeof value.dateKey === "string" ? value.dateKey : todayKey(),
      adjectives: [value.adjectives[0], value.adjectives[1]] as [string, string],
      guesses: value.guesses as GuessResult[],
      currentTurnIndex:
        typeof value.currentTurnIndex === "number" ? value.currentTurnIndex : 0,
      appealsRemaining:
        typeof value.appealsRemaining === "number"
          ? value.appealsRemaining
          : 1,
    };
  }
  // Old format - reject it to force a new game
  return null;
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
    const idx = Math.min(Math.max(state.currentTurnIndex, 0), 4);
    return { idx, roundIndex: idx };
  }, [state]);

  const isComplete = useMemo(() => {
    if (!state) return false;
    return state.currentTurnIndex >= 5;
  }, [state]);

  const totalScore = useMemo(() => {
    if (!state) return 0;
    // Best combined score (score1 + score2) across all guesses
    return state.guesses.reduce((best, g) => {
      if (!g.scores) return best;
      const combined = g.scores[0] + g.scores[1];
      return Math.max(best, combined);
    }, 0);
  }, [state]);

  const submitGuessLocally = useCallback(
    (roundIndex: number, noun: string) => {
      setState((prev) => {
        if (!prev) return prev;
        const guesses = prev.guesses.map((g, ri) =>
          ri === roundIndex
            ? { ...g, noun: noun.trim(), isPass: false }
            : g,
        );
        return { ...prev, guesses };
      });
    },
    [],
  );

  const submitPassLocally = useCallback(
    (roundIndex: number) => {
      setState((prev) => {
        if (!prev) return prev;
        const guesses = prev.guesses.map((g, ri) => {
          // The explicit pass the player just chose
          if (ri === roundIndex) {
            return { ...g, noun: g.noun || "PASS", scores: [0, 0] as [number, number], isPass: true };
          }
          // Auto-pass any remaining unanswered rounds
          if (ri > roundIndex && !g.noun && !g.isPass) {
            return { ...g, noun: "PASS", scores: [0, 0] as [number, number], isPass: true };
          }
          return g;
        });
        return { ...prev, guesses };
      });
    },
    [],
  );

  const advanceTurn = useCallback(() => {
    setState((prev) => {
      if (!prev) return prev;
      const maxTurns = 5;
      let nextTurnIndex = prev.currentTurnIndex + 1;
      // Skip passes
      while (nextTurnIndex < maxTurns) {
        const guess = prev.guesses[nextTurnIndex];
        if (guess?.isPass) {
          nextTurnIndex++;
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
      roundIndex: number,
      scores: [number, number],
      reasonings: [string, string],
    ) => {
      setState((prev) => {
        if (!prev) return prev;
        const guesses = prev.guesses.map((g, ri) =>
          ri === roundIndex
            ? { ...g, scores, reasonings }
            : g,
        );

        // If a perfect 20 (10+10) was achieved, auto-mark all remaining empty
        // guesses as "Perfect Score Achieved" so they show up explicitly in the UI.
        if (scores[0] === 10 && scores[1] === 10) {
          for (let i = roundIndex + 1; i < guesses.length; i++) {
            const g = guesses[i];
            if (!g.noun && !g.isPass) {
              guesses[i] = {
                ...g,
                noun: "Perfect Score Achieved",
                scores: [10, 10] as [number, number],
                isPass: true,
              };
            }
          }
        }

        return { ...prev, guesses };
      });
    },
    [],
  );

  const applyAppealResult = useCallback(
    (
      roundIndex: number,
      newScores: [number, number],
      newReasonings: [string, string],
      appealTokenConsumed: boolean,
    ) => {
      setState((prev) => {
        if (!prev) return prev;
        const previousScores = prev.guesses[roundIndex]?.scores ?? [0, 0];
        const delta: [number, number] = [
          Math.max(0, newScores[0] - previousScores[0]),
          Math.max(0, newScores[1] - previousScores[1]),
        ];

        const guesses = prev.guesses.map((g, ri) =>
          ri === roundIndex
            ? {
                ...g,
                scores: newScores,
                reasonings: newReasonings,
                appealed: true,
                appealDelta: delta,
              }
            : g,
        );
        // Single appeal token for the whole game, always consumed when used.
        const appealsRemaining = Math.max(0, prev.appealsRemaining - 1);

        return { ...prev, guesses, appealsRemaining };
      });
    },
    [],
  );

  const resetDaily = useCallback(() => {
    setState(createNewDailyState());
  }, []);

  const forceRandomDebugGame = useCallback(() => {
    const selected = [...BASE_ADJECTIVES]
      .sort(() => Math.random() - 0.5)
      .slice(0, 2);
    if (selected.length !== 2) {
      throw new Error("Expected exactly 2 adjectives");
    }
    setState({
      mode: "debug-random",
      dateKey: todayKey(),
      adjectives: [selected[0], selected[1]] as [string, string],
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
