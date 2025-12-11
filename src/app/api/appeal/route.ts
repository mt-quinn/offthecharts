import { NextResponse } from "next/server";
import { DEFAULT_MODEL_ID, getOpenAIClient } from "@/lib/openai";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      adjective?: string;
      noun?: string;
      originalScore?: number;
      originalReasoning?: string;
      appealText?: string;
    };

    const { adjective, noun, originalScore, originalReasoning, appealText } =
      body;

    if (!adjective || !noun || !originalScore || !appealText) {
      return NextResponse.json(
        { error: "Missing required appeal fields" },
        { status: 400 },
      );
    }

    const openai = getOpenAIClient();

    const prompt = buildAppealPrompt(
      adjective,
      noun,
      originalScore,
      originalReasoning || "",
      appealText,
    );

    const response = await openai.chat.completions.create({
      model: DEFAULT_MODEL_ID,
      messages: [
        {
          role: "system",
          content: prompt,
        },
      ],
      max_completion_tokens: 220,
      reasoning_effort:
        DEFAULT_MODEL_ID === "gpt-5.1-2025-11-13" ? ("none" as any) : "minimal",
      verbosity: "low",
    });

    const raw = response.choices[0]?.message?.content?.trim() ?? "";
    const { newScore, reasoning, accepted } = parseAppealResponse(
      raw,
      originalScore,
    );

    return NextResponse.json({ newScore, reasoning, accepted });
  } catch (error) {
    console.error("Error in /api/appeal:", error);
    return NextResponse.json(
      { error: "Failed to process appeal" },
      { status: 500 },
    );
  }
}

function buildAppealPrompt(
  adjective: string,
  noun: string,
  originalScore: number,
  originalReasoning: string,
  appealText: string,
): string {
  return `You are the replay booth judge for a word-association game.

Players are scored 1–10 on how well their ANSWER matches a CATEGORY. They may file a short text appeal if they think the score was unfair.
Your job is to re-evaluate the score once, taking their appeal into account, and either keep the score or raise it. Never lower the score.

CATEGORY WORD: ${adjective}
ANSWER: ${noun}
ORIGINAL SCORE (1–10): ${originalScore}
ORIGINAL REASONING: ${originalReasoning || "(none provided)"}
PLAYER'S APPEAL (max 256 chars): ${appealText}

Rules:
- You may keep the score the same or increase it up to 10.
- Only increase if the appeal surfaces a genuinely strong reason the answer fits the category better than you first judged.
- Small improvements (e.g., +1–2) are fine when the appeal is modestly persuasive.
- Larger jumps (e.g., +3 or more) should be rare and reserved for clearly misjudged but excellent answers.
- Be conservative but fair; it's okay to say no.

Respond ONLY with strict JSON in this shape (no extra text, no commentary):
{"newScore": <integer >= originalScore and <= 10>, "accepted": <true_if_score_increased_else_false>, "reasoning": "<1-2 short sentences summarizing your ruling>"}`.trim();
}

function parseAppealResponse(
  raw: string,
  originalScore: number,
): { newScore: number; reasoning: string; accepted: boolean } {
  // Try JSON parse first
  try {
    const parsed = JSON.parse(raw) as {
      newScore?: number;
      accepted?: boolean;
      reasoning?: string;
    };

    if (typeof parsed.newScore === "number") {
      const base = Math.max(originalScore, parsed.newScore);
      const clamped = Math.min(10, Math.max(originalScore, Math.round(base)));
      const accepted = clamped > originalScore || parsed.accepted === true;
      return {
        newScore: clamped,
        reasoning: parsed.reasoning?.toString() || "",
        accepted,
      };
    }
  } catch {
    // ignore and fall through
  }

  const match = raw.match(/"newScore"\s*:\s*(\d)/i);
  const numeric = match ? Number(match[1]) : originalScore;
  const clamped = Math.min(10, Math.max(originalScore, Math.round(numeric)));

  const reasoningMatch = raw.match(/"reasoning"\s*:\s*"([\s\S]*?)"\s*}?$/i);
  const reasoning = reasoningMatch ? reasoningMatch[1] : raw;

  const accepted = clamped > originalScore;

  return { newScore: clamped, reasoning, accepted };
}
