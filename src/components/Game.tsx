"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { GuessResult, useDailyGameState } from "@/hooks/useDailyGameState";

type ScoreResponse = {
  score: number;
  reasoning: string;
  // Optional index (0–2) of the answer the LLM considers
  // the best overall for this adjective so far, among all
  // answers in this category.
  favoriteIndex?: number | null;
};

type AppealResponse = {
  newScore: number;
  reasoning: string;
  accepted?: boolean;
};

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

  const [appealOpenFor, setAppealOpenFor] = useState<
    | { adjectiveIndex: number; roundIndex: number }
    | null
  >(null);
  const [appealText, setAppealText] = useState("");
  const [appealSubmitting, setAppealSubmitting] = useState(false);
  const [appealError, setAppealError] = useState<string | null>(null);

  // Reference to the main guess input so we can autofocus it
  const guessInputRef = useRef<HTMLInputElement | null>(null);

  // Temporarily force debug tools on in all builds (including production)
  // so they are available while testing.
  const isDebug = true;

  // Keep the input in sync only when we actually move to a new turn
  // (category/guess pair). This avoids wiping in-progress typing when
  // background scoring updates earlier guesses.
  const lastTurnIdxRef = useRef<number | null>(null);

  useEffect(() => {
    if (!state || !currentTurn) return;

    const isSameTurn = lastTurnIdxRef.current === currentTurn.idx;
    lastTurnIdxRef.current = currentTurn.idx;

    const { adjectiveIndex, roundIndex } = currentTurn;
    const guess = state.guesses[adjectiveIndex]?.[roundIndex];
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

  const handleSubmitGuess = async () => {
    if (!state || !currentTurn || submitting || awaitingNextCategory) return;
    const trimmed = currentInput.trim();
    if (!trimmed) {
      setError("Enter a word or phrase to lock in your guess.");
      return;
    }

    const { adjectiveIndex, roundIndex } = currentTurn;
    const adjective = state.adjectives[adjectiveIndex];

    // Ban answers that essentially just repeat the category word:
    // - exactly the same as the adjective
    // - or differ only by adding/removing up to 2 characters at either end
    const normalizedAdjective = adjective.trim().toLowerCase();
    const normalizedAnswer = trimmed.toLowerCase();
    const lengthDiff = Math.abs(
      normalizedAnswer.length - normalizedAdjective.length,
    );
    const sharesPrefix =
      normalizedAnswer.startsWith(normalizedAdjective) ||
      normalizedAdjective.startsWith(normalizedAnswer);
    const isForbiddenCategoryEcho =
      normalizedAnswer === normalizedAdjective ||
      (sharesPrefix && lengthDiff <= 2);
    if (isForbiddenCategoryEcho) {
      setError("You can't just submit the category as your guess.");
      return;
    }

    // Block exact duplicate answers for the same category in this game
    const priorAnswersForCategory = state.guesses[adjectiveIndex]
      .slice(0, roundIndex)
      .filter((g) => !g.isPass)
      .map((g) => g.noun.trim().toLowerCase())
      .filter(Boolean);
    if (priorAnswersForCategory.includes(trimmed.toLowerCase())) {
      setError("You've already used that answer for this category. Try a new one.");
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      const previousNouns = state.guesses[adjectiveIndex]
        .slice(0, roundIndex)
        .map((g) => g.noun)
        .filter(Boolean);

      const res = await fetch("/api/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adjective,
          noun: trimmed,
          previousNouns,
        }),
      });

      if (!res.ok) {
        throw new Error("Scoring failed");
      }

      const data = (await res.json()) as ScoreResponse;
      submitGuessLocally(adjectiveIndex, roundIndex, trimmed);
      if (typeof data.score === "number") {
        applyScore(
          adjectiveIndex,
          roundIndex,
          data.score,
          data.reasoning,
          data.favoriteIndex ?? null,
        );

        // If the model gives a perfect 10/10, treat the category as finished:
        // show the \"Next round\" / \"See results\" phase instead of
        // auto-advancing immediately.
        if (data.score >= 10) {
          setAwaitingNextCategory(true);
          return;
        }
      }

      if (roundIndex < 2) {
        advanceTurn();
      } else {
        setAwaitingNextCategory(true);
      }
    } catch (e) {
      console.error(e);
      // Still record the guess locally so the game can progress
      submitGuessLocally(adjectiveIndex, roundIndex, trimmed);
      if (roundIndex < 2) {
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

  const openAppeal = (adjectiveIndex: number, roundIndex: number) => {
    setAppealOpenFor({ adjectiveIndex, roundIndex });
    setAppealText("");
    setAppealError(null);
  };

  const cancelAppeal = () => {
    setAppealOpenFor(null);
    setAppealText("");
    setAppealError(null);
  };

  const submitAppeal = async () => {
    if (!state || !appealOpenFor) return;
    const { adjectiveIndex, roundIndex } = appealOpenFor;
    const guess = state.guesses[adjectiveIndex]?.[roundIndex];
    if (!guess || guess.appealed || !guess.score) return;

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
      const adjective = state.adjectives[adjectiveIndex];
      const res = await fetch("/api/appeal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adjective,
          noun: guess.noun,
          originalScore: guess.score,
          originalReasoning: guess.reasoning ?? "",
          appealText: trimmed,
        }),
      });

      if (!res.ok) {
        throw new Error("Appeal failed");
      }

      const data = (await res.json()) as AppealResponse;
      const newScore =
        typeof data.newScore === "number" && data.newScore > 0
          ? data.newScore
          : guess.score;
      const newReasoning = data.reasoning || guess.reasoning || "";

      const accepted = data.accepted ?? newScore > (guess.score ?? 0);

      applyAppealResult(
        adjectiveIndex,
        roundIndex,
        newScore ?? guess.score,
        newReasoning,
        !accepted,
        null,
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

  const { adjectiveIndex, roundIndex } = currentTurn;
  const adjective = state.adjectives[adjectiveIndex];

  const previousRoundsForThisAdjective = state.guesses[adjectiveIndex]
    // Include the current guess slot as \"previous\" once it has a noun,
    // so that after the 3rd answer is scored it's visible during the
    // \"Next round\" waiting state.
    .slice(0, roundIndex + 1)
    .filter((g) => g.noun);

  const currentGuess = state.guesses[adjectiveIndex][roundIndex];

  const getBestIndexForCategory = (
    guesses: GuessResult[],
    favoriteIndex: number | null | undefined,
  ): number => {
    const scores = guesses.map((g) => g.score ?? 0);
    const bestScore = Math.max(0, ...scores);
    if (bestScore <= 0) return -1;

    const candidateIndices = scores
      .map((_, i) => i)
      .filter((i) => scores[i] === bestScore && !guesses[i].isPass);
    if (candidateIndices.length === 0) return -1;

    if (
      typeof favoriteIndex === "number" &&
      candidateIndices.includes(favoriteIndex)
    ) {
      return favoriteIndex;
    }

    return candidateIndices[0];
  };

  const currentRoundMax = isComplete
    ? 30
    : Math.min(30, (adjectiveIndex + 1) * 10);

  return (
    <div className="h-full flex flex-col">
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

      <header className="px-4 pt-2 pb-2">
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
        <div className="px-4 pb-1.5">
          <button
            type="button"
            onClick={() => {
              setAwaitingNextCategory(false);
              advanceTurn();
            }}
            className="w-full inline-flex items-center justify-center rounded-full bg-gradient-to-r from-otc-accent-strong to-otc-accent-alt px-4 py-2 text-sm font-semibold text-black shadow-otc-glow"
          >
            {adjectiveIndex === state.adjectives.length - 1
              ? "See results"
              : "Next round"}
          </button>
        </div>
      )}

      <div className="flex-1 flex flex-col px-3 pb-3 gap-2.5 overflow-y-auto">
        {!isComplete && (
          <>
            <section className="relative rounded-xl bg-black/20 border border-white/10 px-3 py-2.5 shadow-inner flex flex-col gap-1.5 items-center">
              <div className="mt-0.5 text-[0.8rem] sm:text-sm font-semibold text-otc-muted text-center">
                Submit a word, phrase, person, or concept that is
              </div>
              <div className="mt-0.5 font-display text-2xl sm:text-3xl text-otc-accent-strong drop-shadow-otc-glow text-center">
                {adjective.toUpperCase()}
              </div>
              <div className="absolute bottom-1 right-3 text-[0.7rem] sm:text-xs font-medium text-otc-muted tracking-[0.16em] uppercase">
                Round {adjectiveIndex + 1} of 3
              </div>
            </section>

            <section className="rounded-xl bg-otc-bg-soft/80 border border-white/5 px-3 py-3 flex flex-col gap-2.5">
              {previousRoundsForThisAdjective.length > 0 && (
                <div className="space-y-1">
                  <div className="text-xs sm:text-sm tracking-[0.25em] uppercase text-otc-accent-alt font-semibold text-center">
                    Category Scoreboard
                  </div>
                  <div className="space-y-1">
                    {(() => {
                      const guessesForCategory = state.guesses[adjectiveIndex];
                      const favoriteIndex =
                        state.favoriteIndices?.[adjectiveIndex] ?? null;
                      const bestIndex = getBestIndexForCategory(
                        guessesForCategory,
                        favoriteIndex,
                      );
                      return previousRoundsForThisAdjective.map((g, idx) => (
                        <PreviousGuessRow
                          key={`${adjectiveIndex}-${idx}`}
                          roundLabel={`Guess ${idx + 1}`}
                          guess={g}
                          adjectiveIndex={adjectiveIndex}
                          roundIndex={idx}
                          onAppeal={openAppeal}
                          appealsRemaining={0}
                          canAppealNow={false}
                          isBest={
                            previousRoundsForThisAdjective.length >= 2 &&
                            bestIndex === idx &&
                            (g.score ?? 0) > 0 &&
                            !g.isPass
                          }
                        />
                      ));
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
                          {roundIndex === 0 && (
                            <>
                              <span>{`Try a\u00a0`}</span>
                              <span className="font-semibold text-otc-accent-strong">
                                Concept
                              </span>
                              <span>{`\u00a0that feels\u00a0`}</span>
                              <span className="font-semibold text-otc-accent">
                                {adjective}
                              </span>
                              <span>{`\u00a0to you`}</span>
                            </>
                          )}
                          {roundIndex === 1 && (
                            <>
                              <span>{`Try a\u00a0`}</span>
                              <span className="font-semibold text-otc-accent-strong">
                                Person
                              </span>
                              <span>{`\u00a0that feels\u00a0`}</span>
                              <span className="font-semibold text-otc-accent">
                                {adjective}
                              </span>
                              <span>{`\u00a0to you`}</span>
                            </>
                          )}
                          {roundIndex === 2 && (
                            <>
                              <span>{`Try a\u00a0`}</span>
                              <span className="font-semibold text-otc-accent-strong">
                                Whole Sentence
                              </span>
                              <span>{`\u00a0that feels\u00a0`}</span>
                              <span className="font-semibold text-otc-accent">
                                {adjective}
                              </span>
                              <span>{`\u00a0to you`}</span>
                            </>
                          )}
                        </div>
                      )}
                      <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[0.7rem] text-otc-muted/70">
                        {currentInput.length}/64
                      </div>
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
                    {previousRoundsForThisAdjective.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          if (!state || !currentTurn || submitting) return;
                          const { adjectiveIndex, roundIndex } = currentTurn;
                          submitPassLocally(adjectiveIndex, roundIndex);
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
              <span className="text-otc-muted text-sm"> / 30 possible points.</span>
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
              {state.adjectives.map((adj, ai) => {
                const guessesForCategory = state.guesses[ai];
                const scores = guessesForCategory.map((g) => g.score ?? 0);
                const bestScore = Math.max(0, ...scores);
                const favoriteIndex =
                  state.favoriteIndices?.[ai] ?? null;
                const bestIndex = getBestIndexForCategory(
                  guessesForCategory,
                  favoriteIndex,
                );
                const hasPerfect = guessesForCategory.some(
                  (g) => (g.score ?? 0) >= 10 && !g.isPass,
                );

                return (
                  <div
                    key={adj + ai}
                    className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[0.65rem] uppercase tracking-[0.18em] text-otc-muted">
                          Category {ai + 1}
                        </span>
                        <span className="font-display text-base text-otc-accent">
                          {adj.toUpperCase()}
                        </span>
                      </div>
                      {bestScore > 0 && (
                        <div className="text-[0.7rem] text-otc-accent-alt">
                          Best: {bestScore} / 10
                        </div>
                      )}
                    </div>
                    <div className="mt-1 grid grid-cols-1 gap-1.5">
                      {guessesForCategory.map((g, ri) => (
                        <PreviousGuessRow
                          key={`${ai}-${ri}`}
                          roundLabel={`Guess ${ri + 1}`}
                          guess={g}
                          adjectiveIndex={ai}
                          roundIndex={ri}
                          onAppeal={openAppeal}
                          appealsRemaining={state.appealsRemaining}
                          canAppealNow={isComplete && !hasPerfect}
                          isBest={
                            ri === bestIndex && (g.score ?? 0) > 0 && !g.isPass
                          }
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>

      {appealOpenFor && (
        <AppealModal
          guess={
            state.guesses[appealOpenFor.adjectiveIndex][
              appealOpenFor.roundIndex
            ]
          }
          adjective={
            state.adjectives[appealOpenFor.adjectiveIndex] ?? "this category"
          }
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
  adjectiveIndex: number;
  roundIndex: number;
  onAppeal: (adjectiveIndex: number, roundIndex: number) => void;
  appealsRemaining: number;
  canAppealNow?: boolean;
  isBest?: boolean;
};

function PreviousGuessRow({
  roundLabel,
  guess,
  adjectiveIndex,
  roundIndex,
  onAppeal,
  appealsRemaining,
  canAppealNow = true,
  isBest = false,
}: PreviousGuessRowProps) {
  // Only treat true, original 10/10 answers as PERFECT.
  // Auto-filled \"Perfect Score Achieved\" rows are marked isPass and should
  // not get the PERFECT highlight pill.
  const isPerfect = (guess.score ?? 0) >= 10 && !guess.isPass;

  const canAppeal =
    canAppealNow &&
    !guess.appealed &&
    typeof guess.score === "number" &&
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
      className={`flex items-start justify-between gap-2 text-xs rounded-xl px-3 py-2 border ${containerHighlightClasses}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[0.65rem] uppercase tracking-[0.18em] text-otc-muted">
            {roundLabel}
          </span>
          {typeof guess.score === "number" && !guess.isPass && (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.65rem] ${
                isPerfect
                  ? "bg-otc-accent-alt text-black shadow-otc-glow"
                  : isBest
                  ? "bg-otc-accent-strong text-black shadow-otc-glow"
                  : "bg-otc-accent/15 text-otc-accent-alt"
              }`}
            >
              <span className="font-semibold">{guess.score}</span>
              <span className="opacity-80">/10</span>
              {isPerfect && (
                <span className="uppercase tracking-[0.16em]">Perfect</span>
              )}
              {!isPerfect && isBest && (
                <span className="uppercase tracking-[0.16em]">Best</span>
              )}
            </span>
          )}
          {guess.appealed && (
            <span className="ml-1 text-[0.6rem] uppercase tracking-[0.18em] text-otc-muted">
              {(() => {
                const delta = guess.appealDelta ?? 0;
                if (delta > 0) {
                  return `Appealed (+${delta})`;
                }
                return "Appealed (Rejected)";
              })()}
            </span>
          )}
        </div>
        <div className="mt-0.5 text-[0.85rem] font-medium text-otc-text break-words">
          {guess.noun}
        </div>
        {guess.reasoning && (
          <div className="mt-0.5 text-[0.75rem] leading-snug font-semibold text-otc-muted whitespace-pre-wrap">
            {guess.reasoning}
          </div>
        )}
      </div>
      <div className="flex flex-col items-end gap-1">
        {canAppeal && (
          <button
            type="button"
            onClick={() => onAppeal(adjectiveIndex, roundIndex)}
            className="rounded-full border border-otc-accent-alt/60 px-2 py-0.5 text-[0.65rem] text-otc-accent-alt bg-black/40 hover:bg-black/60 transition"
          >
            Appeal
          </button>
        )}
      </div>
    </div>
  );
}

type AppealModalProps = {
  guess: GuessResult;
  adjective: string;
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
  adjective,
  appealsRemaining,
  appealText,
  onAppealTextChange,
  onCancel,
  onSubmit,
  submitting,
  error,
}: AppealModalProps) {
  if (!guess) return null;

  return (
    <div className="absolute inset-0 bg-black/60 flex items-center justify-center px-4 py-4">
      <div className="w-full max-w-sm rounded-2xl bg-otc-bg-soft border border-otc-accent/40 shadow-otc-card px-4 py-3 space-y-2 text-sm">
        <div className="text-[0.7rem] tracking-[0.2em] uppercase text-otc-muted">
          Coach's challenge
        </div>
        <div className="text-base font-semibold">
          Appealing "{guess.noun}" for{" "}
          <span className="text-otc-accent">{adjective}</span>
        </div>
        {typeof guess.score === "number" && (
          <div className="text-[0.8rem] text-otc-muted">
            Current score: <span className="font-semibold">{guess.score}/10</span>
          </div>
        )}
        {guess.reasoning && (
          <div className="text-[0.85rem] font-semibold text-otc-muted">
            Judge's take: {guess.reasoning}
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
