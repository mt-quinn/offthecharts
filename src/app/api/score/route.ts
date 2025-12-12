import { NextResponse } from "next/server";
import { DEFAULT_MODEL_ID, getOpenAIClient } from "@/lib/openai";

export async function POST(req: Request) {
  try {
    const { adjective1, adjective2, noun, previousNouns, placeholderCategory } = (await req.json()) as {
      adjective1?: string;
      adjective2?: string;
      noun?: string;
      previousNouns?: string[];
      placeholderCategory?: string;
    };

    if (!adjective1 || !adjective2 || !noun) {
      return NextResponse.json(
        { error: "Missing adjective1, adjective2, or noun" },
        { status: 400 },
      );
    }

    const openai = getOpenAIClient();

    const prompt = buildScoringPrompt(adjective1, adjective2, noun, previousNouns || [], placeholderCategory);

    const response = await openai.chat.completions.create({
      model: DEFAULT_MODEL_ID,
      messages: [
        {
          role: "system",
          content: prompt,
        },
      ],
      max_completion_tokens: 180,
      reasoning_effort:
        DEFAULT_MODEL_ID === "gpt-5.1-2025-11-13" ? ("none" as any) : "minimal",
      verbosity: "low",
    });

    const raw = response.choices[0]?.message?.content?.trim() ?? "";

    const { score1, score2, reasoning1, reasoning2 } = parseScoringResponse(raw);

    return NextResponse.json({ score1, score2, reasoning1, reasoning2 });
  } catch (error) {
    console.error("Error in /api/score:", error);
    return NextResponse.json(
      { error: "Failed to score guess" },
      { status: 500 },
    );
  }
}

function buildScoringPrompt(
  adjective1: string,
  adjective2: string,
  noun: string,
  previousNouns: string[],
  placeholderCategory?: string,
): string {
  const allAnswers = [...previousNouns, noun];

  const indexedAnswers =
    allAnswers.length === 0
      ? "(none yet)"
      : allAnswers
          .map((answer, index) => `${index}: ${answer}`)
          .join("; ");

  const categoryContext = placeholderCategory 
    ? `\n\nCONTEXT NOTE: The player saw a prompt suggesting they try a "${placeholderCategory}". This is provided ONLY for context to help you understand why they might have given this type of answer. Do NOT use this to penalize them - if they gave a different type of answer, that's perfectly fine. Score based solely on how well the answer matches the two adjectives, regardless of whether it matches the suggested category type.`
    : "";

  return `You are the strict, impartial judge and charismatic host of a groovy TV game show.

The player is given TWO ADJECTIVES and tries to name WORDS AND PHRASES that feel like strong, vivid matches to BOTH adjectives simultaneously.
Your job is to rate each answer on how well it matches EACH adjective separately (1–10 for each), then give a short, in-character explanation, as if you are talking directly to the contestant on stage.${categoryContext}

SCORING SCALE (1–10 for EACH adjective, you MUST use the whole range):
- 1–2 = very weak fit; barely or not really connected to the adjective.
- 3–4 = partial or generic fit; some connection, but far from ideal.
- 5–6 = decent fit; clearly on theme, but missing key aspects.
- 7–8 = strong fit; vivid and satisfying, but still leaving clear room to feel even more like the adjective.
- 9    = excellent fit; extremely strong and clearly on-theme.
- 10   = iconic answer for this adjective: as strong and on-theme as you would reasonably hope for in a party game.

IMPORTANT: obscure, specific, or surprising answers are WELCOME.
- Do NOT lower a score just because an answer is niche, uncommon, personal, or oddly specific.
- As long as the concept clearly embodies the adjective, it can earn a very high score, including 10/10.
- Score each adjective INDEPENDENTLY. An answer might be a 10/10 for one adjective and a 6/10 for the other, and that's perfectly fine.

CALIBRATION (how to think about the scale):
- Imagine a range of good answers for each adjective, not a single \"right\" one.
- A 10/10 should feel like it sits at the very top of that range: a delightfully strong match you would happily celebrate on the show.
- Most reasonable answers should land somewhere in the 3–8 range, but do NOT be so strict that 10/10 almost never occurs; it is fine for obviously excellent answers to reach 10/10.
- Use the full 1–10 range over many games; avoid clustering everything at the very top, but do not treat 10 as nearly forbidden.

PROGRESSION BONUS (player trajectory matters):
- First, decide the objective base scores (1–10 for each adjective) for the CURRENT ANSWER in isolation.
- Then, compare it to all PREVIOUS ANSWERS:
  - If the current answer is clearly a stronger, more archetypal fit for an adjective than every previous answer, you may bump that adjective's score up by +1 (without ever exceeding 10).
  - If it is not clearly better than the best previous answer for that adjective, do NOT apply the progression bonus.
  - Never apply more than a +1 progression bonus per adjective on top of the base score.

ADJECTIVE 1: ${adjective1}
ADJECTIVE 2: ${adjective2}
CURRENT ANSWER: ${noun}
ANSWER LIST (oldest to newest, with indices):
${indexedAnswers}

The index of the CURRENT ANSWER in this list is ${
    allAnswers.length - 1
  } (0-based).

If you are unsure between two scores, choose the *lower* score.

You must provide TWO separate reasonings, one for each adjective:
- reasoning1: A single, tight, characterful sentence in the voice of a game show host explaining why the CURRENT ANSWER scores what it does for ADJECTIVE 1.
- reasoning2: A single, tight, characterful sentence in the voice of a game show host explaining why the CURRENT ANSWER scores what it does for ADJECTIVE 2.

Keep both reasonings fun and talky, but still concise.
- Do NOT talk as if there is one secret \"perfect\" answer you were hoping for.
- Do NOT say things like "not quite the perfect example" or "there are better answers out there".
Instead, briefly describe what makes this answer feel on-theme for that specific adjective (and, if relevant, what keeps it from being even higher) without suggesting that a single correct answer exists.
Do NOT mention or compare to any other specific objects, examples, or nouns (no "like a rocket", "not as shiny as a mirror", etc.).
Only describe how well THIS ANSWER matches that adjective in absolute terms.
- Each reasoning should focus ONLY on its respective adjective, not both.

Respond ONLY with strict JSON in this shape (no extra text, no commentary):
{"score1": <integer 1-10 for adjective1>, "score2": <integer 1-10 for adjective2>, "reasoning1": "<one short sentence for adjective1>", "reasoning2": "<one short sentence for adjective2>"}`.trim();
}

function parseScoringResponse(raw: string): {
  score1: number;
  score2: number;
  reasoning1: string;
  reasoning2: string;
} {
  // Try JSON first
  try {
    const parsed = JSON.parse(raw) as {
      score1?: number;
      score2?: number;
      reasoning1?: string;
      reasoning2?: string;
    };
    if (typeof parsed.score1 === "number" && typeof parsed.score2 === "number") {
      const clamped1 = Math.min(10, Math.max(1, Math.round(parsed.score1)));
      const clamped2 = Math.min(10, Math.max(1, Math.round(parsed.score2)));
      const reasoning1 = (parsed.reasoning1 ?? "").toString();
      const reasoning2 = (parsed.reasoning2 ?? "").toString();
      return {
        score1: clamped1,
        score2: clamped2,
        reasoning1,
        reasoning2,
      };
    }
  } catch {
    // fall through to regex
  }

  // Fallback regex parsing
  const match1 = raw.match(/"score1"\s*:\s*(\d+)/i);
  const match2 = raw.match(/"score2"\s*:\s*(\d+)/i);
  const score1Num = match1 ? Number(match1[1]) : 5;
  const score2Num = match2 ? Number(match2[1]) : 5;
  const clamped1 = Math.min(10, Math.max(1, Math.round(score1Num)) || 5);
  const clamped2 = Math.min(10, Math.max(1, Math.round(score2Num)) || 5);

  const reasoning1Match = raw.match(/"reasoning1"\s*:\s*"([\s\S]*?)"/i);
  const reasoning2Match = raw.match(/"reasoning2"\s*:\s*"([\s\S]*?)"/i);
  const reasoning1 = reasoning1Match ? reasoning1Match[1] : "";
  const reasoning2 = reasoning2Match ? reasoning2Match[1] : "";

  return { score1: clamped1, score2: clamped2, reasoning1, reasoning2 };
}
