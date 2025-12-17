"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
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
  "Cultural Icon",
  "Whole Sentence",
  "Sports Team",
  "Organism",
  "Philosophy",
  "Scenario",
  "Piece of Media",
  "Organization",
  "Piece of Technology",
  "Product"
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
  // Reference to the category display
  const categoryRef = useRef<HTMLElement | null>(null);
  // Track previous cumulative scores for smooth animation transitions
  const prevCumulativeScoresRef = useRef<[number, number]>([0, 0]);
  // Track which placeholder categories have been used for each round
  const usedCategoriesRef = useRef<Map<number, string>>(new Map());
  
  // Particle system state
  const [activeParticles, setActiveParticles] = useState<Array<{
    id: string;
    isPink: boolean;
    segmentIndex: number;
    startX: number;
    startY: number;
    endX: number;
    endY: number;
  }>>([]);
  const [pendingTopBarUpdates, setPendingTopBarUpdates] = useState<Set<number>>(new Set());
  const prevFilledSegmentsRef = useRef<[number, number]>([0, 0]); // Track previous filled segment counts
  const leftPillarRef = useRef<HTMLDivElement | null>(null);
  const rightPillarRef = useRef<HTMLDivElement | null>(null);
  const topBarRef = useRef<HTMLDivElement | null>(null);
  const particleTimeoutIdsRef = useRef<NodeJS.Timeout[]>([]);

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
    // For daily mode, use dateKey; for debug-random, use adjectives to ensure fresh categories per game
    const gameKey = state.mode === "debug-random" 
      ? `random-${state.adjectives[0]}-${state.adjectives[1]}`
      : state.dateKey;
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

  // Calculate cumulative scores for animation (must be before early return)
  const getCumulativeScoresForAnimation = (): [number, number] => {
    if (!state) return [0, 0];
    let total1 = 0;
    let total2 = 0;
    state.guesses.forEach((guess) => {
      if (guess.scores && !guess.isPass) {
        total1 += guess.scores[0];
        total2 += guess.scores[1];
      }
    });
    return [total1, total2];
  };

  // Get a category for the current round (deterministic for daily, random for debug-random)
  const placeholderCategory = useMemo(() => {
    if (!state || !currentTurn) return PLACEHOLDER_CATEGORIES[0];
    const roundIndex = currentTurn.roundIndex;
    
    // Check if we already have a category assigned for this round
    if (usedCategoriesRef.current.has(roundIndex)) {
      return usedCategoriesRef.current.get(roundIndex)!;
    }
    
    // For debug-random mode, use truly random selection
    if (state.mode === "debug-random") {
      const used = Array.from(usedCategoriesRef.current.values());
      const available = PLACEHOLDER_CATEGORIES.filter(cat => !used.includes(cat));
      const pool = available.length > 0 ? available : PLACEHOLDER_CATEGORIES;
      // Shuffle the pool to ensure truly random selection
      const shuffled = [...pool].sort(() => Math.random() - 0.5);
      const selected = shuffled[0];
      usedCategoriesRef.current.set(roundIndex, selected);
      return selected;
    }
    
    // For daily mode, deterministically select all 3 categories based on dateKey
    const dateKey = state.dateKey;
    let hash = 0;
    for (let i = 0; i < dateKey.length; i++) {
      hash = (hash * 31 + dateKey.charCodeAt(i)) >>> 0;
    }
    
    // Select 3 categories deterministically for rounds 0-2
    const selectedCategories: string[] = [];
    const available = [...PLACEHOLDER_CATEGORIES];
    
    for (let round = 0; round < 3; round++) {
      hash = (hash * 1664525 + 1013904223) >>> 0; // LCG
      const idx = hash % available.length;
      selectedCategories.push(available[idx]);
      available.splice(idx, 1);
    }
    
    // Store all categories for all rounds
    selectedCategories.forEach((cat, idx) => {
      usedCategoriesRef.current.set(idx, cat);
    });
    
    return selectedCategories[roundIndex];
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
        applyScore(
          roundIndex,
          [data.score1, data.score2],
          [data.reasoning1 || "", data.reasoning2 || ""],
        );
        
        // Update previous scores after a delay to allow state to update
        setTimeout(() => {
          const [newScore1, newScore2] = getCumulativeScoresForAnimation();
          prevCumulativeScoresRef.current = [newScore1, newScore2];
        }, 100);
      }

      if (roundIndex < 2) {
        advanceTurn();
      } else {
        // Last guess - auto-advance to completion after scoring
        setTimeout(() => {
          advanceTurn();
        }, 500); // Small delay to let score animation play
      }
    } catch (e) {
      console.error(e);
      // Still record the guess locally so the game can progress
      submitGuessLocally(roundIndex, trimmed);
      if (roundIndex < 2) {
        advanceTurn();
      } else {
        // Last guess - auto-advance to completion after scoring
        setTimeout(() => {
          advanceTurn();
        }, 500); // Small delay to let score animation play
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

  // Calculate cumulative scores (sum of all guesses) - must be before early return
  const getCumulativeScores = (): [number, number] => {
    if (!state) return [0, 0];
    let total1 = 0;
    let total2 = 0;
    state.guesses.forEach((guess) => {
      if (guess.scores && !guess.isPass) {
        total1 += guess.scores[0];
        total2 += guess.scores[1];
      }
    });
    return [total1, total2];
  };

  const [cumulativeScore1, cumulativeScore2] = getCumulativeScores();

  // Calculate filled segments for each adjective
  const getFilledSegments = (score: number): number => {
    return Math.min(5, Math.floor(Math.min(score, 25) / 5));
  };

  const filledSegments1 = getFilledSegments(cumulativeScore1);
  const filledSegments2 = getFilledSegments(cumulativeScore2);

  // Calculate top bar score based on confirmed segments (only what particles have reached)
  // For final score, use actual filled segments if game is complete and no particles are active
  const getTopBarScore = (): number => {
    if (isComplete && activeParticles.length === 0) {
      // Game is complete and all particles have finished - use actual filled segments
      return filledSegments1 + filledSegments2;
    }
    // During gameplay, only count confirmed segments
    return pendingTopBarUpdates.size;
  };

  const topBarScore = getTopBarScore();

  // Detect new segments and trigger particles - MUST be before early return
  useEffect(() => {
    if (!state || !leftPillarRef.current || !rightPillarRef.current || !topBarRef.current) {
      // Update ref even if refs aren't ready to keep it in sync
      const new1 = getFilledSegments(cumulativeScore1);
      const new2 = getFilledSegments(cumulativeScore2);
      prevFilledSegmentsRef.current = [new1, new2];
      return;
    }
    
    const [prev1, prev2] = prevFilledSegmentsRef.current;
    const new1 = getFilledSegments(cumulativeScore1);
    const new2 = getFilledSegments(cumulativeScore2);

    if (new1 > prev1 || new2 > prev2) {
      // Wait a bit for DOM to update, then calculate positions
      const timeoutId = setTimeout(() => {
        // Double-check refs are still available
        if (!leftPillarRef.current || !rightPillarRef.current || !topBarRef.current) {
          prevFilledSegmentsRef.current = [new1, new2];
          return;
        }
        
        // Clear any previous particle timeouts (shouldn't happen, but safety)
        particleTimeoutIdsRef.current.forEach(id => clearTimeout(id));
        particleTimeoutIdsRef.current = [];
        
        const particlesToAdd: Array<{
          id: string;
          isPink: boolean;
          segmentIndex: number;
          startX: number;
          startY: number;
          endX: number;
          endY: number;
        }> = [];

        // Helper to get segment center position in pillar
        const getPillarSegmentCenter = (pillarRef: React.RefObject<HTMLDivElement | null>, segmentIndex: number): { x: number; y: number } | null => {
          if (!pillarRef.current) return null;
          const pillar = pillarRef.current;
          const segmentsContainer = pillar.firstElementChild as HTMLElement;
          if (!segmentsContainer) return null;
          const segments = segmentsContainer.children;
          if (segments.length === 0) return null;
          
          // Segments are in reverse order (flex-col-reverse), so segmentIndex 0 is the last segment
          const actualIndex = segments.length - 1 - segmentIndex;
          const segment = segments[actualIndex] as HTMLElement;
          if (!segment) return null;
          
          const segmentRect = segment.getBoundingClientRect();
          return {
            x: segmentRect.left + segmentRect.width / 2,
            y: segmentRect.top + segmentRect.height / 2,
          };
        };

        // Helper to get top bar segment center position
        const getTopBarSegmentCenter = (segmentIndex: number): { x: number; y: number } | null => {
          if (!topBarRef.current) return null;
          const segmentsContainer = topBarRef.current;
          const segments = segmentsContainer.children;
          if (segments.length === 0) return null;
          const segment = segments[segmentIndex] as HTMLElement;
          if (!segment) return null;
          
          const segmentRect = segment.getBoundingClientRect();
          return {
            x: segmentRect.left + segmentRect.width / 2,
            y: segmentRect.top + segmentRect.height / 2,
          };
        };

        // Create particles for new segments in adjective1 (pink)
        for (let i = prev1; i < new1; i++) {
          const pillarPos = getPillarSegmentCenter(leftPillarRef, i);
          const topBarPos = getTopBarSegmentCenter(i);
          if (pillarPos && topBarPos) {
            particlesToAdd.push({
              id: `pink-${i}-${Date.now()}-${Math.random()}`,
              isPink: true,
              segmentIndex: i,
              startX: pillarPos.x,
              startY: pillarPos.y,
              endX: topBarPos.x,
              endY: topBarPos.y,
            });
          }
        }

        // Create particles for new segments in adjective2 (cyan)
        for (let i = prev2; i < new2; i++) {
          const pillarPos = getPillarSegmentCenter(rightPillarRef, i);
          const topBarPos = getTopBarSegmentCenter(i + 5); // Cyan segments are 5-9 in top bar
          if (pillarPos && topBarPos) {
            particlesToAdd.push({
              id: `cyan-${i}-${Date.now()}-${Math.random()}`,
              isPink: false,
              segmentIndex: i + 5, // Store as top bar index
              startX: pillarPos.x,
              startY: pillarPos.y,
              endX: topBarPos.x,
              endY: topBarPos.y,
            });
          }
        }

        // Add particles sequentially with delays (charge-up time + stagger)
        particlesToAdd.forEach((particle, index) => {
          const particleTimeoutId = setTimeout(() => {
            setActiveParticles(prev => [...prev, particle]);
          }, 400 + index * 300); // 400ms charge-up, then 300ms between each particle
          particleTimeoutIdsRef.current.push(particleTimeoutId);
        });

        prevFilledSegmentsRef.current = [new1, new2];
      }, 100); // Small delay to ensure DOM has updated

      return () => {
        clearTimeout(timeoutId);
        // Clean up any particle timeouts that were scheduled
        particleTimeoutIdsRef.current.forEach(id => clearTimeout(id));
        particleTimeoutIdsRef.current = [];
      };
    } else {
      // Update ref even if no new segments to keep it in sync
      prevFilledSegmentsRef.current = [new1, new2];
    }
  }, [cumulativeScore1, cumulativeScore2, state]);

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

  const maxScore = 25; // Maximum cumulative score per adjective (capped at 25 for visualization)

  return (
    <div className="h-full flex flex-col relative">

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
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="text-[0.6rem] tracking-[0.35em] uppercase text-otc-muted">
              Tonight's game
            </div>
            <div className="font-display text-xl sm:text-2xl text-otc-accent drop-shadow-[0_4px_10px_rgba(0,0,0,0.7)]">
              Off the Charts
            </div>
          </div>

          {/* Top score bar: 10 thin vertical containers (5 pink, 5 cyan) - hidden on end screen */}
          {!isComplete && (
            <div className="flex-shrink-0 flex flex-col items-end gap-1">
              <div className="text-[0.65rem] text-otc-muted uppercase tracking-[0.1em]">Score</div>
              <div className="flex items-center gap-2">
                <div className="text-[0.7rem] font-semibold text-otc-accent-alt">{topBarScore} / 10</div>
                <div ref={topBarRef} className="flex items-center gap-0.5 w-32">
                  {Array.from({ length: 10 }, (_, i) => {
                    const isPink = i < 5;
                    const isFilled = pendingTopBarUpdates.has(i);
                    
                    return (
                      <div
                        key={i}
                        className={`flex-1 h-4 rounded-sm border transition-all duration-500 ${
                          isFilled
                            ? isPink
                              ? 'bg-pink-400 border-pink-500 shadow-[0_0_4px_rgba(244,114,182,0.6)]'
                              : 'bg-cyan-400 border-cyan-500 shadow-[0_0_4px_rgba(34,211,238,0.6)]'
                            : 'bg-white/10 border-white/20'
                        }`}
                      />
                    );
                  })}
            </div>
          </div>
            </div>
          )}
          {/* Keep ref for particles even when hidden */}
          {isComplete && <div ref={topBarRef} className="hidden" />}
        </div>
      </header>


      {!isComplete && (
        <div className="px-7 mb-3">
          <section 
            ref={categoryRef}
            className="px-3 py-2 rounded-xl bg-black/20 border border-white/10 shadow-inner flex flex-col gap-1.5 items-center"
          >
            <div className="mt-0.5 text-[0.8rem] sm:text-sm font-semibold text-otc-muted text-center">
              Submit a word, phrase, person, or concept that is
            </div>
            <div className="mt-0.5 font-display text-xl sm:text-2xl drop-shadow-otc-glow text-center flex items-center justify-center">
              <div className="flex items-center gap-1">
                <span className="text-pink-400">{adjective1.toUpperCase()}</span>
                <span style={{ color: 'rgb(255, 179, 21)' }}> & </span>
                <span className="text-cyan-400">{adjective2.toUpperCase()}</span>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* Render particles */}
      {activeParticles.map(particle => {
        const handleParticleComplete = () => {
          setActiveParticles(prev => prev.filter(p => p.id !== particle.id));
          setPendingTopBarUpdates(prev => new Set([...prev, particle.segmentIndex]));
        };
        
        return (
          <Particle
            key={particle.id}
            id={particle.id}
            isPink={particle.isPink}
            startX={particle.startX}
            startY={particle.startY}
            endX={particle.endX}
            endY={particle.endY}
            onComplete={handleParticleComplete}
          />
        );
      })}

      {/* Unified Scoreboard */}
      <div className="flex-1 flex flex-col gap-0 px-7 pb-3 min-h-0">
        {/* Wrapper with unified border */}
        <div className="flex-1 flex flex-col rounded-xl border overflow-hidden min-h-0" style={{ borderColor: 'rgba(255, 255, 255, 0.2)' }}>
          {/* Top Row: Pillars + Scoreboard */}
          <div className="flex-1 flex items-stretch gap-0 min-h-0">
          {/* Left Pillar */}
          <div ref={leftPillarRef} className="w-10 flex-shrink-0 pt-2 overflow-hidden bg-otc-bg-soft/80">
            <div className="h-full flex flex-col-reverse gap-1 px-1.5 relative">
            {Array.from({ length: 5 }, (_, i) => {
              const segmentThreshold = (i + 1) * 5; // Segment 0 = 5pts, segment 4 = 25pts
              const prevThreshold = i * 5; // Previous segment threshold
              const cappedScore = Math.min(cumulativeScore1, 25);
              
              // Calculate how much of this segment should be filled
              let segmentFillPercent = 0;
              const isMilestoneReached = cappedScore >= segmentThreshold;
              // Check if this segment has reached milestone but particle hasn't been confirmed yet
              const hasActiveParticle = activeParticles.some(p => p.isPink && p.segmentIndex === i);
              const isConfirmed = pendingTopBarUpdates.has(i);
              const isCharging = isMilestoneReached && !isConfirmed && !hasActiveParticle && i < filledSegments1;
              
              if (cappedScore >= segmentThreshold) {
                segmentFillPercent = 100;
              } else if (cappedScore > prevThreshold) {
                segmentFillPercent = ((cappedScore - prevThreshold) / 5) * 100;
              }
              
              return (
                <div
                  key={i}
                  className="w-full flex-1 rounded relative overflow-hidden border border-pink-400/30 bg-black/30"
                >
                  {/* Fill segment - clipped by segment boundaries */}
                  <div
                    className={`absolute bottom-0 left-0 right-0 bg-pink-400 shadow-[0_0_4px_rgba(244,114,182,0.6)] rounded ${
                      isCharging ? 'animate-pulse' : ''
                    }`}
                    style={{
                      height: `${segmentFillPercent}%`,
                      transition: 'height 0.5s linear',
                      boxShadow: isCharging 
                        ? '0 0 12px rgba(244,114,182,0.9), 0 0 20px rgba(244,114,182,0.6)' 
                        : '0 0 4px rgba(244,114,182,0.6)',
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>

          {/* Middle Content Area - Scrollable */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0">
            <div className="flex-1 overflow-y-auto">
              {!isComplete ? (
                <section className="bg-otc-bg-soft/80 px-3 py-2 flex flex-col gap-2 min-h-full">
                <div className="space-y-1.5">
                  <div className="text-lg tracking-[0.25em] uppercase text-otc-accent-alt font-semibold text-center">
                    Scoreboard
                  </div>
                    {previousGuesses.length > 0 ? (
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
                    ) : (
                      <div className="text-center py-8">
                        <div className="text-[0.75rem] text-otc-muted/60">
                          No Judgements Passed Yet
                  </div>
                </div>
              )}
                  </div>
                </section>
              ) : (
                <div className="space-y-3 pb-3">
                  {/* Complete State - Final Score Display */}
                  <section className="rounded-2xl bg-black/30 border border-otc-accent/40 px-4 py-3 space-y-3">
                    <div className="text-[0.7rem] tracking-[0.2em] uppercase text-otc-muted text-center">
                      Final Score
                    </div>
                    <div className="flex flex-col items-center gap-3">
                      <div className="text-4xl sm:text-5xl font-bold text-otc-accent-alt">
                        {topBarScore} / 10
                      </div>
                      <div className="flex items-center justify-center gap-0.5 w-full max-w-xs">
                        {Array.from({ length: 10 }, (_, i) => {
                          const isPink = i < 5;
                          const isFilled = pendingTopBarUpdates.has(i) || (isComplete && activeParticles.length === 0 && (isPink ? i < filledSegments1 : i - 5 < filledSegments2));
                          
                          return (
                            <div
                              key={i}
                              className={`flex-1 h-6 rounded-sm border transition-all duration-500 ${
                                isFilled
                                  ? isPink
                                    ? 'bg-pink-400 border-pink-500 shadow-[0_0_4px_rgba(244,114,182,0.6)]'
                                    : 'bg-cyan-400 border-cyan-500 shadow-[0_0_4px_rgba(34,211,238,0.6)]'
                                  : 'bg-white/10 border-white/20'
                              }`}
                            />
                          );
                        })}
                      </div>
                    </div>
                    <div className="text-[0.8rem] sm:text-sm font-semibold text-center" style={{ color: 'rgb(255, 179, 21)' }}>
                      That's a wrap! Scroll down to review the game and appeal your most
                      underrated answer.
                    </div>
                  </section>

                  {/* Complete State - Appeals Section */}
                  <section className="rounded-2xl bg-otc-bg-soft/90 border border-white/10 px-4 py-3 space-y-2">
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
                        </div>
                        <div className="mt-1 grid grid-cols-1 gap-1.5">
                          {state.guesses.map((g, ri) => {
                            const combinedScore = g.scores ? g.scores[0] + g.scores[1] : 0;
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
                                canAppealNow={isComplete}
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
                </div>
              )}
            </div>
          </div>

          {/* Right Pillar */}
          <div ref={rightPillarRef} className="w-10 flex-shrink-0 pt-2 overflow-hidden bg-otc-bg-soft/80">
            <div className="h-full flex flex-col-reverse gap-1 px-1.5 relative">
              {Array.from({ length: 5 }, (_, i) => {
                const segmentThreshold = (i + 1) * 5; // Segment 0 = 5pts, segment 4 = 25pts
                const prevThreshold = i * 5; // Previous segment threshold
                const cappedScore = Math.min(cumulativeScore2, 25);
                
                // Calculate how much of this segment should be filled
                let segmentFillPercent = 0;
                const isMilestoneReached = cappedScore >= segmentThreshold;
                // Check if this segment has reached milestone but particle hasn't been confirmed yet
                const topBarIndex = i + 5; // Cyan segments are 5-9 in top bar
                const hasActiveParticle = activeParticles.some(p => !p.isPink && p.segmentIndex === topBarIndex);
                const isConfirmed = pendingTopBarUpdates.has(topBarIndex);
                const isCharging = isMilestoneReached && !isConfirmed && !hasActiveParticle && i < filledSegments2;
                
                if (cappedScore >= segmentThreshold) {
                  segmentFillPercent = 100;
                } else if (cappedScore > prevThreshold) {
                  segmentFillPercent = ((cappedScore - prevThreshold) / 5) * 100;
                }
                
                return (
                  <div
                    key={i}
                    className="w-full flex-1 rounded relative overflow-hidden border border-cyan-400/30 bg-black/30"
                  >
                    {/* Fill segment - clipped by segment boundaries */}
                    <div
                      className={`absolute bottom-0 left-0 right-0 bg-cyan-400 shadow-[0_0_4px_rgba(34,211,238,0.6)] rounded ${
                        isCharging ? 'animate-pulse' : ''
                      }`}
                      style={{
                        height: `${segmentFillPercent}%`,
                        transition: 'height 0.5s linear',
                        boxShadow: isCharging 
                          ? '0 0 12px rgba(34,211,238,0.9), 0 0 20px rgba(34,211,238,0.6)' 
                          : '0 0 4px rgba(34,211,238,0.6)',
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>

          {/* Bottom Row: Input Container - Full Width */}
          {!isComplete && (
            <div className="flex-shrink-0">
              {awaitingNextCategory && roundIndex < 2 ? (
                <button
                  type="button"
                  onClick={() => {
                    setAwaitingNextCategory(false);
                    advanceTurn();
                  }}
                  className="w-full inline-flex items-center justify-center rounded-full bg-gradient-to-r from-otc-accent-strong to-otc-accent-alt px-4 py-2 text-sm font-semibold text-black shadow-otc-glow"
                >
                  Continue
                </button>
              ) : !awaitingNextCategory ? (
                <section className="bg-otc-bg-soft/80 px-3 py-2 flex flex-col gap-2">
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
                        <div className="pointer-events-none absolute inset-y-0 left-3 right-3 flex items-center text-otc-muted overflow-hidden">
                          <div className="whitespace-nowrap overflow-hidden flex items-center" style={{ fontSize: 'clamp(0.7rem, 2.5vw, 0.875rem)' }}>
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
                      : `Submit for Judgement (${roundIndex + 1}/3)`}
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
            </section>
            ) : null}
                    </div>
                  )}
                </div>
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

// Particle component with ghost trail
type ParticleProps = {
  id: string;
  isPink: boolean;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  onComplete: () => void;
};

function Particle({ id, isPink, startX, startY, endX, endY, onComplete }: ParticleProps) {
  const [position, setPosition] = useState({ x: startX, y: startY });
  const [ghostTrail, setGhostTrail] = useState<Array<{ x: number; y: number; opacity: number; id: number }>>([]);
  const trailIdRef = useRef(0);
  const animationFrameRef = useRef<number | null>(null);
  const lastPosRef = useRef({ x: startX, y: startY });
  const ghostTimeoutsRef = useRef<NodeJS.Timeout[]>([]);
  const onCompleteRef = useRef(onComplete);

  // Keep onComplete ref up to date
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    const duration = 800; // 800ms animation
    const startTime = Date.now();
    const dx = endX - startX;
    const dy = endY - startY;
    
    // Create arc path (parabolic)
    const arcHeight = -Math.abs(dy) * 0.5; // Negative for upward arc
    
    let isCancelled = false;
    
    const animate = () => {
      if (isCancelled) return;
      
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // Ease-out curve
      const eased = 1 - Math.pow(1 - progress, 3);
      
      // Calculate position along arc
      const x = startX + dx * eased;
      const y = startY + dy * eased + arcHeight * Math.sin(eased * Math.PI);
      
      setPosition({ x, y });
      
      // Add ghost to trail if moved enough
      const distFromLast = Math.sqrt(
        Math.pow(x - lastPosRef.current.x, 2) + Math.pow(y - lastPosRef.current.y, 2)
      );
      if (distFromLast > 2) { // Add ghost every 2px of movement
        const newGhost = {
          x,
          y,
          opacity: 1,
          id: trailIdRef.current++,
        };
        setGhostTrail(prev => [...prev, newGhost]);
        lastPosRef.current = { x, y };
        
        // Fade out ghosts quickly
        const timeout1 = setTimeout(() => {
          if (!isCancelled) {
            setGhostTrail(prev => prev.map(g => g.id === newGhost.id ? { ...g, opacity: 0 } : g));
            const timeout2 = setTimeout(() => {
              if (!isCancelled) {
                setGhostTrail(prev => prev.filter(g => g.id !== newGhost.id));
              }
            }, 150);
            ghostTimeoutsRef.current.push(timeout2);
          }
        }, 50);
        ghostTimeoutsRef.current.push(timeout1);
      }
      
      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(animate);
      } else {
        if (!isCancelled) {
          onCompleteRef.current();
        }
      }
    };
    
    animationFrameRef.current = requestAnimationFrame(animate);
    
    return () => {
      isCancelled = true;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      // Clean up all ghost timeouts
      ghostTimeoutsRef.current.forEach(timeout => clearTimeout(timeout));
      ghostTimeoutsRef.current = [];
    };
  }, [startX, startY, endX, endY]);

  const color = isPink ? 'rgb(244, 114, 182)' : 'rgb(34, 211, 238)';
  
  return (
    <>
      {/* Ghost trail */}
      {ghostTrail.map(ghost => (
        <div
          key={ghost.id}
          className="fixed pointer-events-none rounded-full"
          style={{
            left: `${ghost.x}px`,
            top: `${ghost.y}px`,
            width: '8px',
            height: '8px',
            backgroundColor: color,
            opacity: ghost.opacity * 0.5,
            transform: 'translate(-50%, -50%)',
            boxShadow: `0 0 4px ${color}`,
            transition: 'opacity 0.15s linear',
            zIndex: 999,
          }}
        />
      ))}
      {/* Main particle */}
      <div
        className="fixed pointer-events-none rounded-full"
        style={{
          left: `${position.x}px`,
          top: `${position.y}px`,
          width: '10px',
          height: '10px',
          backgroundColor: color,
          transform: 'translate(-50%, -50%)',
          boxShadow: `0 0 8px ${color}`,
          zIndex: 1000,
        }}
      />
    </>
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
  const combinedScore = guess.scores ? guess.scores[0] + guess.scores[1] : 0;

  const canAppeal =
    canAppealNow &&
    !guess.appealed &&
    guess.scores &&
    appealsRemaining > 0 &&
    !guess.isPass;
  const containerHighlightClasses = isBest
    ? "bg-otc-accent-strong/10 border-otc-accent-strong/60"
    : "bg-black/30 border-white/10";

  return (
    <div
      className={`rounded-lg px-2.5 py-1.5 border ${containerHighlightClasses}`}
    >
      <div className="flex flex-col items-center gap-1 mb-1">
        <div className="flex items-center w-full relative">
            {guess.scores && !guess.isPass && isBest && (
              <div className="absolute left-0 text-lg font-bold uppercase tracking-[0.16em] text-otc-accent-strong">
                BEST
            </div>
          )}
          <div className="flex items-center justify-center gap-4 flex-1">
            <div className="text-sm font-bold uppercase text-otc-text break-words text-center">
              {guess.noun}
            </div>
            {guess.scores && !guess.isPass && (
              <div className={`text-lg font-bold ${
                  isBest
                  ? "text-otc-accent-strong"
                  : "text-otc-accent-alt"
              }`}>
                {combinedScore}<span className="text-sm opacity-70">/20</span>
              </div>
            )}
          </div>
        </div>
        {guess.appealed && (
          <div className="text-[0.6rem] uppercase tracking-[0.18em] text-otc-muted">
            {(() => {
              const delta = guess.appealDelta;
              if (delta && (delta[0] > 0 || delta[1] > 0)) {
                return `+${delta[0] + delta[1]}`;
              }
              return "Rejected";
            })()}
          </div>
        )}
        {canAppeal && (
          <button
            type="button"
            onClick={() => onAppeal(roundIndex)}
            className="rounded-full border border-otc-accent-alt/60 px-1.5 py-0.5 text-[0.65rem] text-otc-accent-alt bg-black/40 hover:bg-black/60 transition"
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
