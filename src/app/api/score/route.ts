import { NextResponse } from "next/server";
import { DEFAULT_MODEL_ID, getOpenAIClient } from "@/lib/openai";

export async function POST(req: Request) {
  try {
    const { adjective, noun, previousNouns } = (await req.json()) as {
      adjective?: string;
      noun?: string;
      previousNouns?: string[];
    };

    if (!adjective || !noun) {
      return NextResponse.json(
        { error: "Missing adjective or noun" },
        { status: 400 },
      );
    }

    const openai = getOpenAIClient();

    const prompt = buildScoringPrompt(adjective, noun, previousNouns || []);

    const response = await openai.chat.completions.create({
      model: DEFAULT_MODEL_ID,
      messages: [
        {
          role: "system",
          content: prompt,
        },
      ],
      max_completion_tokens: 120,
      reasoning_effort:
        DEFAULT_MODEL_ID === "gpt-5.1-2025-11-13" ? ("none" as any) : "minimal",
      verbosity: "low",
    });

    const raw = response.choices[0]?.message?.content?.trim() ?? "";

    const { score, reasoning, favoriteIndex } = parseScoringResponse(raw);

    return NextResponse.json({ score, reasoning, favoriteIndex });
  } catch (error) {
    console.error("Error in /api/score:", error);
    return NextResponse.json(
      { error: "Failed to score guess" },
      { status: 500 },
    );
  }
}

function buildScoringPrompt(
  adjective: string,
  noun: string,
  previousNouns: string[],
): string {
  const allAnswers = [...previousNouns, noun];

  const indexedAnswers =
    allAnswers.length === 0
      ? "(none yet)"
      : allAnswers
          .map((answer, index) => `${index}: ${answer}`)
          .join("; ");

  return `You are the strict, impartial judge and charismatic host of a groovy TV game show.

The player is given an ADJECTIVE and tries to name WORDS AND PHRASES that feel like strong, vivid matches.
Your job is to rate each answer and give a short, in-character explanation, as if you are talking directly to the contestant on stage.

SCORING SCALE (1–10, you MUST use the whole range):
- 1–2 = very weak fit; barely or not really connected to the adjective.
- 3–4 = partial or generic fit; some connection, but far from ideal.
- 5–6 = decent fit; clearly on theme, but missing key aspects.
- 7–8 = strong fit; vivid and satisfying, but still leaving clear room to feel even more like the adjective.
- 9    = excellent fit; extremely strong and clearly on-theme.
- 10   = iconic answer for this adjective: as strong and on-theme as you would reasonably hope for in a party game.

IMPORTANT: obscure, specific, or surprising answers are WELCOME.
- Do NOT lower a score just because an answer is niche, uncommon, personal, or oddly specific.
- As long as the concept clearly embodies the adjective, it can earn a very high score, including 10/10.

CALIBRATION (how to think about the scale):
- Imagine a range of good answers for this adjective, not a single \"right\" one.
- A 10/10 should feel like it sits at the very top of that range: a delightfully strong match you would happily celebrate on the show.
- Most reasonable answers should land somewhere in the 3–8 range, but do NOT be so strict that 10/10 almost never occurs; it is fine for obviously excellent answers to reach 10/10.
- Use the full 1–10 range over many games; avoid clustering everything at the very top, but do not treat 10 as nearly forbidden.

PROGRESSION BONUS (player trajectory matters):
- First, decide the objective base score (1–10) for the CURRENT ANSWER in isolation.
- Then, compare it to all PREVIOUS ANSWERS for this adjective:
  - If the current answer is clearly a stronger, more archetypal fit than every previous answer, you may bump the score up by +1 (without ever exceeding 10).
  - If it is not clearly better than the best previous answer, do NOT apply the progression bonus.
  - Never apply more than a +1 progression bonus on top of the base score.

ADJECTIVE: ${adjective}
CURRENT ANSWER: ${noun}
ANSWER LIST FOR THIS ADJECTIVE (oldest to newest, with indices):
${indexedAnswers}

The index of the CURRENT ANSWER in this list is ${
    allAnswers.length - 1
  } (0-based).

TIE-BREAKER RESPONSIBILITY (when scores are tied):
- After you have decided the scores for ALL answers in the ANSWER LIST, there may be multiple answers that share the same highest score.
- In that case, you MUST choose a single favorite: the one that feels like the most archetypal, on-theme answer for this adjective.
- That favorite will be used by the game UI to highlight which tied answer you consider the best overall.

If you are unsure between two scores, choose the *lower* score.
Your reasoning must be a single, tight, characterful sentence in the voice of a game show host explaining to the contestant why the CURRENT ANSWER's score is what it is (you may mention the progression bonus if you used it).
Keep it fun and talky, but still concise.
- Do NOT talk as if there is one secret \"perfect\" answer you were hoping for.
- Do NOT say things like "not quite the perfect example" or "there are better answers out there".
Instead, briefly describe what makes this answer feel on-theme (and, if relevant, what keeps it from being even higher) without suggesting that a single correct answer exists.
Do NOT mention or compare to any other specific objects, examples, or nouns (no "like a rocket", "not as shiny as a mirror", etc.).
Only describe how well THIS ANSWER matches the adjective in absolute terms.

Respond ONLY with strict JSON in this shape (no extra text, no commentary):
{"score": <integer 1-10>, "reasoning": "<one short sentence>", "favoriteIndex": <integer index of the single best overall answer in the ANSWER LIST (0-based)>}`.trim();
}

function parseScoringResponse(raw: string): {
  score: number;
  reasoning: string;
  favoriteIndex: number | null;
} {
  // Try JSON first
  try {
    const parsed = JSON.parse(raw) as {
      score?: number;
      reasoning?: string;
      favoriteIndex?: number;
    };
    if (typeof parsed.score === "number") {
      const clamped = Math.min(10, Math.max(1, Math.round(parsed.score)));
      const reasoning = (parsed.reasoning ?? "").toString();
      const favoriteIndex =
        typeof parsed.favoriteIndex === "number"
          ? Math.max(0, Math.min(2, Math.floor(parsed.favoriteIndex)))
          : null;
      return {
        score: clamped,
        reasoning,
        favoriteIndex,
      };
    }
  } catch {
    // fall through to regex
  }

  const match = raw.match(/"score"\s*:\s*(\d+)/i);
  const scoreNum = match ? Number(match[1]) : 5;
  const clamped = Math.min(10, Math.max(1, Math.round(scoreNum)) || 5);

  const reasoningMatch = raw.match(/"reasoning"\s*:\s*"([\s\S]*?)"\s*}?$/i);
  const extractedReasoning = reasoningMatch ? reasoningMatch[1] : raw;

  return { score: clamped, reasoning: extractedReasoning, favoriteIndex: null };
}
