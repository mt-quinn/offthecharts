"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { GuessResult, useDailyGameState } from "@/hooks/useDailyGameState";

type ScoreResponse = {
  score1: number;
  score2: number;
  reasoning1: string;
  reasoning2: string;
};

type AppealResponse = {
  newScore1: number;
  newScore2: number;
  reasoning1: string;
  reasoning2: string;
  accepted?: boolean;
};

const PLACEHOLDER_CATEGORIES = [
  "Concept",
  "Cultural Icon",
  "Whole Sentence",
  "Sports Team",
  "Organism",
  "Philosophy",
  "Scenario",
  "Piece of Media",
  "Organization",
  "Piece of Technology",
];

export function Game() {
  const {
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
  } = useDailyGameState();

  const [currentInput, setCurrentInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [awaitingNextCategory, setAwaitingNextCategory] = useState(false);

  const [appealOpenFor, setAppealOpenFor] = useState<number | null>(null);
  const [appealText, setAppealText] = useState("");
  const [appealSubmitting, setAppealSubmitting] = useState(false);
  const [appealError, setAppealError] = useState<string | null>(null);

  // Reference to the main guess input so we can autofocus it
  const guessInputRef = useRef<HTMLInputElement | null>(null);
  // Reference to the category display to measure its bottom for pillar positioning
  const categoryRef = useRef<HTMLElement | null>(null);
  const [categoryBottom, setCategoryBottom] = useState<number>(140);
  // Track if first score has been received (triggers pillar appearance and fill animation)
  const [firstScoreReceived, setFirstScoreReceived] = useState(false);
  // Track if initial fill animation is in progress
  const [isInitialFill, setIsInitialFill] = useState(false);
  // Track which placeholder categories have been used for each round
  const usedCategoriesRef = useRef<Map<number, string>>(new Map());

  // Temporarily force debug tools on in all builds (including production)
  // so they are available while testing.
  const isDebug = true;

  // Keep the input in sync only when we actually move to a new turn
  // (category/guess pair). This avoids wiping in-progress typing when
  // background scoring updates earlier guesses.
  const lastTurnIdxRef = useRef<number | null>(null);
  const lastGameKeyRef = useRef<string | null>(null);

  // Reset used categories when a new game starts
  useEffect(() => {
    if (!state) return;
    const gameKey = `${state.adjectives[0]}-${state.adjectives[1]}-${state.dateKey}`;
    if (lastGameKeyRef.current !== gameKey) {
      usedCategoriesRef.current.clear();
      lastGameKeyRef.current = gameKey;
    }
  }, [state]);

  useEffect(() => {
    if (!state || !currentTurn) return;

    const isSameTurn = lastTurnIdxRef.current === currentTurn.idx;
    lastTurnIdxRef.current = currentTurn.idx;

    const { roundIndex } = currentTurn;
    const guess = state.guesses[roundIndex];
    setCurrentInput(guess?.noun ?? "");
    setError(null);

    // Autofocus the guess input whenever we enter a (possibly new) turn
    // and the input is visible again.
    if (!awaitingNextCategory && guessInputRef.current) {
      // Delay slightly to ensure layout is ready on mobile browsers
      window.setTimeout(() => {
        guessInputRef.current?.focus();
        const length = guessInputRef.current?.value.length ?? 0;
        try {
          guessInputRef.current?.setSelectionRange(length, length);
        } catch {
          // some mobile browsers may not support setSelectionRange here
        }
      }, isSameTurn ? 0 : 20);
    }
  }, [state, currentTurn, awaitingNextCategory]);

  // Measure category section bottom for pillar positioning
  useEffect(() => {
    if (!categoryRef.current) return;
    const updatePosition = () => {
      const rect = categoryRef.current?.getBoundingClientRect();
      const parentRect = categoryRef.current?.offsetParent?.getBoundingClientRect();
      if (rect && parentRect) {
        setCategoryBottom(rect.bottom - parentRect.top);
      }
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    return () => window.removeEventListener('resize', updatePosition);
  }, [state, isComplete, awaitingNextCategory]);

  // Track score changes for animation (must be before early return)
  const getBestScoresForAnimation = (): [number, number] => {
    if (!state) return [0, 0];
    const combinedScores = state.guesses.map((g) => {
      if (!g.scores) return 0;
      return g.scores[0] + g.scores[1];
    });
    const bestScore = Math.max(0, ...combinedScores);
    if (bestScore <= 0) return [0, 0];
    const candidateIndices = combinedScores
      .map((_, i) => i)
      .filter((i) => combinedScores[i] === bestScore && !state.guesses[i].isPass);
    if (candidateIndices.length === 0) return [0, 0];
    const bestGuess = state.guesses[candidateIndices[0]];
    if (!bestGuess.scores) return [0, 0];
    return [bestGuess.scores[0], bestGuess.scores[1]];
  };

  // Get a random unused category for the current round (must be before early return)
  const placeholderCategory = useMemo(() => {
    if (!state || !currentTurn) return PLACEHOLDER_CATEGORIES[0];
    const roundIndex = currentTurn.roundIndex;
    
    // Check if we already have a category assigned for this round
    if (usedCategoriesRef.current.has(roundIndex)) {
      return usedCategoriesRef.current.get(roundIndex)!;
    }
    
    // Get all used categories so far
    const used = Array.from(usedCategoriesRef.current.values());
    
    // Get available categories (not yet used)
    const available = PLACEHOLDER_CATEGORIES.filter(cat => !used.includes(cat));
    
    // If all categories have been used, reset and start over
    const pool = available.length > 0 ? available : PLACEHOLDER_CATEGORIES;
    
    // Pick a random category from the pool
    const selected = pool[Math.floor(Math.random() * pool.length)];
    
    // Store it for this round
    usedCategoriesRef.current.set(roundIndex, selected);
    
    return selected;
  }, [state, currentTurn]);


  const handleSubmitGuess = async () => {
    if (!state || !currentTurn || submitting || awaitingNextCategory) return;
    const trimmed = currentInput.trim();
    if (!trimmed) {
      setError("Enter a word or phrase to lock in your guess.");
      return;
    }

    const { roundIndex } = currentTurn;
    const [adjective1, adjective2] = state.adjectives;

    // Ban answers that essentially just repeat either category word:
    // - exactly the same as either adjective
    // - or differ only by adding/removing up to 2 characters at either end
    const normalized1 = adjective1.trim().toLowerCase();
    const normalized2 = adjective2.trim().toLowerCase();
    const normalizedAnswer = trimmed.toLowerCase();
    const lengthDiff1 = Math.abs(normalizedAnswer.length - normalized1.length);
    const lengthDiff2 = Math.abs(normalizedAnswer.length - normalized2.length);
    const sharesPrefix1 =
      normalizedAnswer.startsWith(normalized1) ||
      normalized1.startsWith(normalizedAnswer);
    const sharesPrefix2 =
      normalizedAnswer.startsWith(normalized2) ||
      normalized2.startsWith(normalizedAnswer);
    const isForbiddenCategoryEcho =
      normalizedAnswer === normalized1 ||
      normalizedAnswer === normalized2 ||
      (sharesPrefix1 && lengthDiff1 <= 2) ||
      (sharesPrefix2 && lengthDiff2 <= 2);
    if (isForbiddenCategoryEcho) {
      setError("You can't just submit the category as your guess.");
      return;
    }

    // Block exact duplicate answers in this game
    const priorAnswers = state.guesses
      .slice(0, roundIndex)
      .filter((g) => !g.isPass)
      .map((g) => g.noun.trim().toLowerCase())
      .filter(Boolean);
    if (priorAnswers.includes(trimmed.toLowerCase())) {
      setError("You've already used that answer. Try a new one.");
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      const previousNouns = state.guesses
        .slice(0, roundIndex)
        .map((g) => g.noun)
        .filter(Boolean);

      const res = await fetch("/api/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adjective1,
          adjective2,
          noun: trimmed,
          previousNouns,
          placeholderCategory,
        }),
      });

      if (!res.ok) {
        throw new Error("Scoring failed");
      }

      const data = (await res.json()) as ScoreResponse;
      submitGuessLocally(roundIndex, trimmed);
      if (typeof data.score1 === "number" && typeof data.score2 === "number") {
        // Mark that first score has been received (triggers pillar appearance)
        if (!firstScoreReceived) {
          setFirstScoreReceived(true);
          // Start initial fill animation after pillars have appeared
          // Don't reset isInitialFill - let it stay true so the fill stays
          setTimeout(() => {
            setIsInitialFill(true);
          }, 300);
        }
        
        applyScore(
          roundIndex,
          [data.score1, data.score2],
          [data.reasoning1 || "", data.reasoning2 || ""],
        );

        // If the model gives a perfect 20 (10+10), treat the game as finished:
        // show the \"See results\" phase instead of auto-advancing immediately.
        if (data.score1 === 10 && data.score2 === 10) {
          setAwaitingNextCategory(true);
          return;
        }
      }

      if (roundIndex < 4) {
        advanceTurn();
      } else {
        setAwaitingNextCategory(true);
      }
    } catch (e) {
      console.error(e);
      // Still record the guess locally so the game can progress
      submitGuessLocally(roundIndex, trimmed);
      if (roundIndex < 4) {
        advanceTurn();
      } else {
        setAwaitingNextCategory(true);
      }
      setError(
        "We couldn't score that guess right now. Your entry is saved; you can keep playing while we retry later.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const openAppeal = (roundIndex: number) => {
    setAppealOpenFor(roundIndex);
    setAppealText("");
    setAppealError(null);
  };

  const cancelAppeal = () => {
    setAppealOpenFor(null);
    setAppealText("");
    setAppealError(null);
  };

  const submitAppeal = async () => {
    if (!state || appealOpenFor === null) return;
    const roundIndex = appealOpenFor;
    const guess = state.guesses[roundIndex];
    if (!guess || guess.appealed || !guess.scores) return;

    const trimmed = appealText.trim();
    if (!trimmed) {
      setAppealError("Add a one-sentence appeal (max 256 characters).");
      return;
    }
    if (trimmed.length > 256) {
      setAppealError("Appeal must be 256 characters or fewer.");
      return;
    }

    setAppealSubmitting(true);
    setAppealError(null);

    try {
      const [adjective1, adjective2] = state.adjectives;
      const res = await fetch("/api/appeal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adjective1,
          adjective2,
          noun: guess.noun,
          originalScore1: guess.scores[0],
          originalScore2: guess.scores[1],
          originalReasoning: guess.reasonings ? `${guess.reasonings[0] || ""} | ${guess.reasonings[1] || ""}` : "",
          appealText: trimmed,
        }),
      });

      if (!res.ok) {
        throw new Error("Appeal failed");
      }

      const data = (await res.json()) as AppealResponse;
      const newScores: [number, number] = [
        typeof data.newScore1 === "number" && data.newScore1 > 0
          ? data.newScore1
          : guess.scores[0],
        typeof data.newScore2 === "number" && data.newScore2 > 0
          ? data.newScore2
          : guess.scores[1],
      ];
      const newReasonings: [string, string] = [
        data.reasoning1 || guess.reasonings?.[0] || "",
        data.reasoning2 || guess.reasonings?.[1] || "",
      ];

      const accepted = data.accepted ?? 
        (newScores[0] > guess.scores[0] || 
        newScores[1] > guess.scores[1]);

      applyAppealResult(
        roundIndex,
        newScores,
        newReasonings,
        !accepted,
      );
      setAppealOpenFor(null);
      setAppealText("");
    } catch (e) {
      console.error(e);
      setAppealError("Appeal could not be processed. Try again later.");
    } finally {
      setAppealSubmitting(false);
    }
  };

  if (!isLoaded || !state || !currentTurn) {
    return (
      <div className="h-full flex items-center justify-center bg-transparent">
        <div className="text-center space-y-2">
          <div className="text-otc-muted text-sm tracking-[0.25em] uppercase">
            Off the Charts
          </div>
          <div className="text-lg font-semibold">Spinning up tonight's show…</div>
        </div>
      </div>
    );
  }

  const { roundIndex } = currentTurn;
  const [adjective1, adjective2] = state.adjectives;

  const previousGuesses = state.guesses
    // Include the current guess slot as \"previous\" once it has a noun,
    // so that after the 5th answer is scored it's visible during the
    // \"See results\" waiting state.
    .slice(0, roundIndex + 1)
    .filter((g) => g.noun);

  const currentGuess = state.guesses[roundIndex];

  const getBestIndex = (guesses: GuessResult[]): number => {
    const combinedScores = guesses.map((g) => {
      if (!g.scores) return 0;
      return g.scores[0] + g.scores[1];
    });
    const bestScore = Math.max(0, ...combinedScores);
    if (bestScore <= 0) return -1;

    const candidateIndices = combinedScores
      .map((_, i) => i)
      .filter((i) => combinedScores[i] === bestScore && !guesses[i].isPass);
    if (candidateIndices.length === 0) return -1;

    return candidateIndices[0];
  };

  const getBestScores = (): [number, number] => {
    if (!state) return [0, 0];
    const bestIndex = getBestIndex(state.guesses);
    if (bestIndex < 0) return [0, 0];
    const bestGuess = state.guesses[bestIndex];
    if (!bestGuess.scores) return [0, 0];
    return [bestGuess.scores[0], bestGuess.scores[1]];
  };

  const currentRoundMax = 20;
  const [bestScore1, bestScore2] = getBestScores();

  return (
    <div className="h-full flex flex-col relative">
      {/* Score pillars on either side */}
      {firstScoreReceived && (
        <>
          <div className="absolute left-2 bottom-6 w-3 pointer-events-none pt-2 overflow-hidden rounded" style={{ top: `${categoryBottom}px`, height: `calc(100% - ${categoryBottom}px - 1.5rem)` }}>
            {/* Segments with fill animation */}
            <div className="h-full flex flex-col-reverse gap-0.5">
              {Array.from({ length: 10 }, (_, i) => {
                const shouldFill = i < bestScore1;
                // With flex-col-reverse, i=0 appears at bottom, i=9 appears at top
                // So delay should be i * 0.18 to fill from bottom to top
                const fillDelay = isInitialFill && bestScore1 > 0 ? (i * 0.18) : 0;
                const fillHeight = isInitialFill && shouldFill ? '100%' : '0%';
                
                return (
                  <div
                    key={i}
                    className="w-full flex-1 rounded relative overflow-hidden"
                    style={{
                      backgroundColor: 'rgba(255, 255, 255, 0.05)',
                    }}
                  >
                    {/* Fill segment - animates from bottom to top */}
                    <div
                      className="absolute bottom-0 left-0 right-0 bg-pink-400 shadow-[0_0_4px_rgba(244,114,182,0.6)] rounded"
                      style={{
                        height: fillHeight,
                        transition: isInitialFill && shouldFill ? `height 0.2s linear ${fillDelay}s` : 'none',
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
          <div className="absolute right-2 bottom-6 w-3 pointer-events-none pt-2 overflow-hidden rounded" style={{ top: `${categoryBottom}px`, height: `calc(100% - ${categoryBottom}px - 1.5rem)` }}>
            {/* Segments with fill animation */}
            <div className="h-full flex flex-col-reverse gap-0.5">
              {Array.from({ length: 10 }, (_, i) => {
                const shouldFill = i < bestScore2;
                // With flex-col-reverse, i=0 appears at bottom, i=9 appears at top
                // So delay should be i * 0.18 to fill from bottom to top
                const fillDelay = isInitialFill && bestScore2 > 0 ? (i * 0.18) : 0;
                const fillHeight = isInitialFill && shouldFill ? '100%' : '0%';
                
                return (
                  <div
                    key={i}
                    className="w-full flex-1 rounded relative overflow-hidden"
                    style={{
                      backgroundColor: 'rgba(255, 255, 255, 0.05)',
                    }}
                  >
                    {/* Fill segment - animates from bottom to top */}
                    <div
                      className="absolute bottom-0 left-0 right-0 bg-cyan-400 shadow-[0_0_4px_rgba(34,211,238,0.6)] rounded"
                      style={{
                        height: fillHeight,
                        transition: isInitialFill && shouldFill ? `height 0.2s linear ${fillDelay}s` : 'none',
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
      {isDebug && (
        <div className="px-3 pt-2 pb-1 text-[0.6rem] text-otc-muted flex items-center justify-between gap-2">
          <span className="uppercase tracking-[0.2em]">Debug</span>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={resetDaily}
              className="rounded-full border border-white/15 px-2 py-0.5 bg-black/20 hover:bg-black/40 transition text-[0.6rem]"
            >
              Reset daily
            </button>
            <button
              type="button"
              onClick={forceRandomDebugGame}
              className="rounded-full border border-otc-accent/40 px-2 py-0.5 bg-otc-accent/20 hover:bg-otc-accent/35 transition text-[0.6rem]"
            >
              Random game
            </button>
          </div>
        </div>
      )}

      <header className="px-8 pt-2 pb-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-[0.6rem] tracking-[0.35em] uppercase text-otc-muted">
              Tonight's game
            </div>
            <div className="font-display text-xl sm:text-2xl text-otc-accent drop-shadow-[0_4px_10px_rgba(0,0,0,0.7)]">
              Off the Charts
            </div>
          </div>

          <div className="text-right text-[0.7rem] leading-tight">
            <div className="text-otc-muted">Score</div>
            <div className="font-semibold text-otc-accent-alt text-sm">
              {totalScore} / {currentRoundMax}
            </div>
          </div>
        </div>
      </header>

      {!isComplete && awaitingNextCategory && (
        <div className="px-8 pb-1.5">
          <button
            type="button"
            onClick={() => {
              setAwaitingNextCategory(false);
              if (roundIndex < 4) {
                advanceTurn();
              }
            }}
            className="w-full inline-flex items-center justify-center rounded-full bg-gradient-to-r from-otc-accent-strong to-otc-accent-alt px-4 py-2 text-sm font-semibold text-black shadow-otc-glow"
          >
            {roundIndex >= 4 ? "See results" : "Continue"}
          </button>
        </div>
      )}

      {!isComplete && (
        <div className="px-7">
          <section 
            ref={categoryRef}
            className="px-3 py-2 rounded-xl bg-black/20 border border-white/10 shadow-inner flex flex-col gap-1.5 items-center"
          >
            <div className="mt-0.5 text-[0.8rem] sm:text-sm font-semibold text-otc-muted text-center">
              Submit a word, phrase, person, or concept that is
            </div>
            <div className="mt-0.5 font-display text-xl sm:text-2xl drop-shadow-otc-glow text-center">
              <span className="text-pink-400">{adjective1.toUpperCase()}</span>
              <span style={{ color: 'rgb(255, 179, 21)' }}> & </span>
              <span className="text-cyan-400">{adjective2.toUpperCase()}</span>
            </div>
          </section>
        </div>
      )}

      <div className={`flex-1 flex flex-col px-7 pb-3 gap-2.5 overflow-y-auto ${!isComplete && previousGuesses.length === 0 ? 'pt-4' : ''}`}>
        {!isComplete && (
          <>

            <section className="rounded-xl bg-otc-bg-soft/80 border border-white/5 px-3 py-2 flex flex-col gap-2">
              {previousGuesses.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-xs tracking-[0.25em] uppercase text-otc-accent-alt font-semibold text-center">
                    Scoreboard
                  </div>
                  <div className="space-y-1.5">
                    {(() => {
                      const bestIndex = getBestIndex(state.guesses);
                      return previousGuesses.map((g, idx) => {
                        const combinedScore = g.scores ? g.scores[0] + g.scores[1] : 0;
                        return (
                          <PreviousGuessRow
                            key={idx}
                            roundLabel={`Guess ${idx + 1}`}
                            guess={g}
                            roundIndex={idx}
                            adjectives={state.adjectives}
                            onAppeal={openAppeal}
                            appealsRemaining={0}
                            canAppealNow={false}
                            isBest={
                              previousGuesses.length >= 2 &&
                              bestIndex === idx &&
                              combinedScore > 0 &&
                              !g.isPass
                            }
                          />
                        );
                      });
                    })()}
                  </div>
                </div>
              )}

              {!awaitingNextCategory && (
                <>
                  <div className="space-y-1">
                    {/* Visually hide the label but keep it for screen readers */}
                    <label htmlFor="noun-input" className="sr-only">
                      Your answer
                    </label>
                    <div className="relative">
                      <input
                        id="noun-input"
                        type="text"
                        autoComplete="off"
                        ref={guessInputRef}
                        value={currentInput}
                        onChange={(e) => setCurrentInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleSubmitGuess();
                          }
                        }}
                        // Real placeholder left blank; we render a custom preview layer instead
                        placeholder=""
                        className="w-full rounded-xl bg-black/40 border border-white/15 pl-3 pr-12 py-2 text-sm text-otc-text shadow-inner"
                        maxLength={64}
                        disabled={submitting}
                      />
                      {!currentInput && !submitting && (
                        <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-otc-muted">
                          <span>{`Try a\u00a0`}</span>
                          <span className="font-semibold" style={{ color: 'rgb(255, 179, 21)' }}>
                            {placeholderCategory}
                          </span>
                          <span>{`\u00a0that feels\u00a0`}</span>
                          <span className="font-semibold text-pink-400">
                            {adjective1}
                          </span>
                          <span>{`\u00a0and\u00a0`}</span>
                          <span className="font-semibold text-cyan-400">
                            {adjective2}
                          </span>
                        </div>
                      )}
                      {currentInput.length > 0 && (
                        <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[0.7rem] text-otc-muted/70">
                          {currentInput.length}/64
                        </div>
                      )}
                    </div>
                  </div>

                  {error && (
                    <div className="text-[0.7rem] text-red-300">{error}</div>
                  )}

                  <div className="mt-1 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={handleSubmitGuess}
                      disabled={submitting || !currentInput.trim()}
                      className="inline-flex flex-1 items-center justify-center rounded-full bg-gradient-to-r from-otc-accent-strong to-otc-accent-alt px-3.5 py-2 text-sm font-semibold text-black shadow-otc-glow disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {submitting
                        ? "Scoring…"
                        : `Submit for Judgement (${roundIndex + 1}/5)`}
                    </button>
                    {previousGuesses.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          if (!state || !currentTurn || submitting) return;
                          const { roundIndex } = currentTurn;
                          submitPassLocally(roundIndex);
                          setAwaitingNextCategory(true);
                        }}
                        className="inline-flex items-center justify-center rounded-full border border-white/25 px-3 py-1.5 text-[0.7rem] font-semibold text-otc-muted bg-black/40 hover:bg-black/60 transition"
                        disabled={submitting}
                      >
                        Pass
                      </button>
                    )}
                  </div>
                </>
              )}
            </section>
          </>
        )}

        {isComplete && (
          <section className="mt-1 rounded-2xl bg-black/30 border border-otc-accent/40 px-4 py-3 space-y-2">
            <div className="text-[0.7rem] tracking-[0.2em] uppercase text-otc-muted">
              Final tally
            </div>
            <div className="text-lg font-semibold">
              You scored <span className="text-otc-accent-alt">{totalScore}</span>
              <span className="text-otc-muted text-sm"> / 20 possible points.</span>
            </div>
            <div className="text-[0.8rem] sm:text-sm font-semibold text-center text-otc-accent-alt">
              That's a wrap! Scroll down to review the game and appeal your most
              underrated answer.
            </div>
          </section>
        )}

        {isComplete && (
          <section className="mt-1 rounded-2xl bg-otc-bg-soft/90 border border-white/10 px-4 py-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[0.7rem] tracking-[0.2em] uppercase text-otc-muted">
                Tonight's board
              </div>
              <div className="text-[0.8rem] sm:text-sm font-semibold text-otc-accent-alt">
                Appeals left: {state.appealsRemaining}
              </div>
            </div>
            <div className="text-[0.75rem] text-otc-muted">
              Tap the "Appeal" button on your most underrated answer to send it
              to the replay booth.
            </div>
            <div className="mt-2 space-y-2">
              <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-display text-base text-otc-accent">
                      {adjective1.toUpperCase()} & {adjective2.toUpperCase()}
                    </span>
                  </div>
                  {totalScore > 0 && (
                    <div className="text-[0.7rem] text-otc-accent-alt">
                      Best: {totalScore} / 20
                    </div>
                  )}
                </div>
                <div className="mt-1 grid grid-cols-1 gap-1.5">
                  {state.guesses.map((g, ri) => {
                    const combinedScore = g.scores ? g.scores[0] + g.scores[1] : 0;
                    const hasPerfect = state.guesses.some(
                      (g) => g.scores && g.scores[0] === 10 && g.scores[1] === 10 && !g.isPass,
                    );
                    const bestIndex = getBestIndex(state.guesses);
                    return (
                      <PreviousGuessRow
                        key={ri}
                        roundLabel={`Guess ${ri + 1}`}
                        guess={g}
                        roundIndex={ri}
                        adjectives={state.adjectives}
                        onAppeal={openAppeal}
                        appealsRemaining={state.appealsRemaining}
                        canAppealNow={isComplete && !hasPerfect}
                        isBest={
                          ri === bestIndex && combinedScore > 0 && !g.isPass
                        }
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          </section>
        )}
      </div>

      {appealOpenFor !== null && (
        <AppealModal
          guess={state.guesses[appealOpenFor]}
          adjectives={state.adjectives}
          appealsRemaining={state.appealsRemaining}
          appealText={appealText}
          onAppealTextChange={setAppealText}
          onCancel={cancelAppeal}
          onSubmit={submitAppeal}
          submitting={appealSubmitting}
          error={appealError}
        />
      )}
    </div>
  );
}

type PreviousGuessRowProps = {
  roundLabel: string;
  guess: GuessResult;
  roundIndex: number;
  adjectives: [string, string];
  onAppeal: (roundIndex: number) => void;
  appealsRemaining: number;
  canAppealNow?: boolean;
  isBest?: boolean;
};

function PreviousGuessRow({
  roundLabel,
  guess,
  roundIndex,
  adjectives,
  onAppeal,
  appealsRemaining,
  canAppealNow = true,
  isBest = false,
}: PreviousGuessRowProps) {
  // Only treat true, original 20 (10+10) answers as PERFECT.
  // Auto-filled \"Perfect Score Achieved\" rows are marked isPass and should
  // not get the PERFECT highlight pill.
  const combinedScore = guess.scores ? guess.scores[0] + guess.scores[1] : 0;
  const isPerfect = guess.scores && guess.scores[0] === 10 && guess.scores[1] === 10 && !guess.isPass;

  const canAppeal =
    canAppealNow &&
    !guess.appealed &&
    guess.scores &&
    appealsRemaining > 0 &&
    !guess.isPass &&
    !isPerfect;
  const containerHighlightClasses = isPerfect
    ? "bg-otc-accent-alt/15 border-otc-accent-alt/60"
    : isBest
    ? "bg-otc-accent-strong/10 border-otc-accent-strong/60"
    : "bg-black/30 border-white/10";

  return (
    <div
      className={`rounded-lg px-2.5 py-1.5 border ${containerHighlightClasses}`}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <div className="text-[0.8rem] font-medium text-otc-text break-words">
            {guess.noun}
          </div>
          {guess.scores && !guess.isPass && (
            <span
              className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[0.65rem] flex-shrink-0 ${
                isPerfect
                  ? "bg-otc-accent-alt text-black shadow-otc-glow"
                  : isBest
                  ? "bg-otc-accent-strong text-black shadow-otc-glow"
                  : "bg-otc-accent/15 text-otc-accent-alt"
              }`}
            >
              <span className="font-semibold">{combinedScore}</span>
              <span className="opacity-80">/20</span>
              {isPerfect && (
                <span className="uppercase tracking-[0.16em] ml-0.5">Perfect</span>
              )}
              {!isPerfect && isBest && (
                <span className="uppercase tracking-[0.16em] ml-0.5">Best</span>
              )}
            </span>
          )}
          {guess.appealed && (
            <span className="text-[0.6rem] uppercase tracking-[0.18em] text-otc-muted flex-shrink-0">
              {(() => {
                const delta = guess.appealDelta;
                if (delta && (delta[0] > 0 || delta[1] > 0)) {
                  return `+${delta[0] + delta[1]}`;
                }
                return "Rejected";
              })()}
            </span>
          )}
        </div>
        {canAppeal && (
          <button
            type="button"
            onClick={() => onAppeal(roundIndex)}
            className="rounded-full border border-otc-accent-alt/60 px-1.5 py-0.5 text-[0.65rem] text-otc-accent-alt bg-black/40 hover:bg-black/60 transition flex-shrink-0"
          >
            Appeal
          </button>
        )}
      </div>

      {guess.scores && guess.reasonings && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          <div className="rounded bg-black/40 border border-white/10 px-2 py-1">
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[0.65rem] font-semibold text-pink-400 uppercase tracking-[0.1em]">
                {adjectives[0]}
              </span>
              <span className="text-[0.75rem] font-bold text-otc-accent-strong">
                {guess.scores[0]}/10
              </span>
            </div>
            <div className="text-[0.65rem] leading-tight text-otc-muted">
              {guess.reasonings[0]}
            </div>
          </div>
          <div className="rounded bg-black/40 border border-white/10 px-2 py-1">
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[0.65rem] font-semibold text-otc-accent-alt uppercase tracking-[0.1em]">
                {adjectives[1]}
              </span>
              <span className="text-[0.75rem] font-bold text-otc-accent-alt">
                {guess.scores[1]}/10
              </span>
            </div>
            <div className="text-[0.65rem] leading-tight text-otc-muted">
              {guess.reasonings[1]}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type AppealModalProps = {
  guess: GuessResult;
  adjectives: [string, string];
  appealsRemaining: number;
  appealText: string;
  onAppealTextChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
  submitting: boolean;
  error: string | null;
};

function AppealModal({
  guess,
  adjectives,
  appealsRemaining,
  appealText,
  onAppealTextChange,
  onCancel,
  onSubmit,
  submitting,
  error,
}: AppealModalProps) {
  if (!guess) return null;
  const [adjective1, adjective2] = adjectives;
  const combinedScore = guess.scores ? guess.scores[0] + guess.scores[1] : 0;

  return (
    <div className="absolute inset-0 bg-black/60 flex items-center justify-center px-4 py-4">
      <div className="w-full max-w-sm rounded-2xl bg-otc-bg-soft border border-otc-accent/40 shadow-otc-card px-4 py-3 space-y-2.5 text-sm">
        <div className="text-[0.7rem] tracking-[0.2em] uppercase text-otc-muted">
          Coach's challenge
        </div>
        <div className="text-base font-semibold">
          Appealing "{guess.noun}" for{" "}
          <span className="text-otc-accent">{adjective1}</span> &{" "}
          <span className="text-otc-accent">{adjective2}</span>
        </div>
        {guess.scores && (
          <div className="text-[0.8rem] text-otc-muted">
            Current combined score: <span className="font-semibold">{combinedScore}/20</span>
          </div>
        )}
        {guess.scores && guess.reasonings && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="rounded-lg bg-black/40 border border-white/10 px-2.5 py-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[0.7rem] font-semibold text-pink-400 uppercase tracking-[0.1em]">
                  {adjective1}
                </span>
                <span className="text-[0.8rem] font-bold text-otc-accent-strong">
                  {guess.scores[0]}/10
                </span>
              </div>
              <div className="text-[0.7rem] leading-snug text-otc-muted">
                {guess.reasonings[0]}
              </div>
            </div>
            <div className="rounded-lg bg-black/40 border border-white/10 px-2.5 py-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[0.7rem] font-semibold text-otc-accent-alt uppercase tracking-[0.1em]">
                  {adjective2}
                </span>
                <span className="text-[0.8rem] font-bold text-otc-accent-alt">
                  {guess.scores[1]}/10
                </span>
              </div>
              <div className="text-[0.7rem] leading-snug text-otc-muted">
                {guess.reasonings[1]}
              </div>
            </div>
          </div>
        )}
        <div className="text-[0.7rem] text-otc-muted">
          You get one appeal for the whole game. Make it count.
        </div>
        <div className="space-y-1.5 pt-1">
          <label
            htmlFor="appeal-text"
            className="text-[0.7rem] tracking-[0.18em] uppercase text-otc-muted"
          >
            Your one-sentence plea ({appealText.length}/256)
          </label>
          <textarea
            id="appeal-text"
            rows={3}
            value={appealText}
            onChange={(e) => onAppealTextChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (!submitting) {
                  onSubmit();
                }
              }
            }}
            maxLength={256}
            placeholder="Come on, that's the perfect fast answer because…"
            className="w-full rounded-xl bg-black/40 border border-white/15 px-3 py-2 text-xs text-otc-text placeholder:text-otc-muted resize-none"
          />
        </div>
        {error && <div className="text-[0.7rem] text-red-300">{error}</div>}
        <div className="flex items-center justify-between pt-1">
          <div className="text-[0.8rem] sm:text-sm font-semibold text-otc-accent-alt">
            Appeals left: {appealsRemaining}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-full border border-white/20 px-3 py-1 text-[0.7rem] text-otc-muted bg-black/40 hover:bg-black/60 transition"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSubmit}
              disabled={submitting}
              className="rounded-full bg-gradient-to-r from-otc-accent-strong to-otc-accent-alt px-3 py-1 text-[0.7rem] font-semibold text-black shadow-otc-glow disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {submitting ? "Sending…" : "Submit appeal"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
