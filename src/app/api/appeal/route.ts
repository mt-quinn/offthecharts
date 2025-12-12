import { NextResponse } from "next/server";
import { DEFAULT_MODEL_ID, getOpenAIClient } from "@/lib/openai";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      adjective1?: string;
      adjective2?: string;
      noun?: string;
      originalScore1?: number;
      originalScore2?: number;
      originalReasoning?: string;
      appealText?: string;
    };

    const { adjective1, adjective2, noun, originalScore1, originalScore2, originalReasoning, appealText } =
      body;

    if (!adjective1 || !adjective2 || !noun || typeof originalScore1 !== "number" || typeof originalScore2 !== "number" || !appealText) {
      return NextResponse.json(
        { error: "Missing required appeal fields" },
        { status: 400 },
      );
    }

    const openai = getOpenAIClient();

    const prompt = buildAppealPrompt(
      adjective1,
      adjective2,
      noun,
      originalScore1,
      originalScore2,
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
      max_completion_tokens: 280,
      reasoning_effort:
        DEFAULT_MODEL_ID === "gpt-5.1-2025-11-13" ? ("none" as any) : "minimal",
      verbosity: "low",
    });

    const raw = response.choices[0]?.message?.content?.trim() ?? "";
    const { newScore1, newScore2, reasoning1, reasoning2, accepted } = parseAppealResponse(
      raw,
      originalScore1,
      originalScore2,
    );

    return NextResponse.json({ newScore1, newScore2, reasoning1, reasoning2, accepted });
  } catch (error) {
    console.error("Error in /api/appeal:", error);
    return NextResponse.json(
      { error: "Failed to process appeal" },
      { status: 500 },
    );
  }
}

function buildAppealPrompt(
  adjective1: string,
  adjective2: string,
  noun: string,
  originalScore1: number,
  originalScore2: number,
  originalReasoning: string,
  appealText: string,
): string {
  return `You are a brutally honest, confrontational game show judge in the style of Simon Cowell reviewing an appeal in the replay booth. You're sharp, opinionated, and never hold back. Your personality is your weapon—use it aggressively.

CRITICAL: Your responses MUST be full of character, personality, and attitude. Never be bland, generic, or safe. Every single response should feel like it came from a real person with strong opinions and a quick wit.

Players are scored 1–10 on how well their ANSWER matches TWO CATEGORIES simultaneously. They may file a short text appeal if they think the scores were unfair.
Your job is to re-evaluate BOTH scores once, taking their appeal into account, and either keep each score or raise it. Never lower a score.

CATEGORY WORD 1: ${adjective1}
CATEGORY WORD 2: ${adjective2}
ANSWER: ${noun}
ORIGINAL SCORE 1 (1–10): ${originalScore1}
ORIGINAL SCORE 2 (1–10): ${originalScore2}
ORIGINAL REASONING: ${originalReasoning || "(none provided)"}
PLAYER'S APPEAL (max 256 chars): ${appealText}

Rules:
- You may keep each score the same or increase it up to 10, independently.
- Only increase a score if the appeal surfaces a genuinely strong reason the answer fits that category better than you first judged.
- Small improvements (e.g., +1–2) are fine when the appeal is modestly persuasive.
- Larger jumps (e.g., +3 or more) should be rare and reserved for clearly misjudged but excellent answers.
- Be conservative but fair; it's okay to say no to either or both increases.
- Score each adjective independently; an appeal might only affect one of the two scores.

You must provide TWO separate reasonings, one for each adjective:
- reasoning1: A 1-2 sentence HIGHLY CHARACTERFUL explanation in your confrontational Simon Cowell-style voice for why the score for ADJECTIVE 1 is what it is (or why it didn't change).
- reasoning2: A 1-2 sentence HIGHLY CHARACTERFUL explanation in your confrontational Simon Cowell-style voice for why the score for ADJECTIVE 2 is what it is (or why it didn't change).

PERSONALITY REQUIREMENTS (MANDATORY):
- EVERY response must have strong personality, attitude, and character. No generic responses allowed.
- Use your voice aggressively: be opinionated, sharp, witty, and memorable.
- Inject personality into EVERY sentence—even simple explanations need your signature style.

APPEAL-SPECIFIC PERSONALITY:
- If you're rejecting the appeal (keeping scores the same): Be direct and brutally honest about why their appeal didn't change your mind. Use sharp, cutting remarks. Make contextually relevant jokes. Don't be gentle—tell them why they're wrong with your signature wit. Examples: "Look, I hear what you're saying, but no. That's still not it." "Nice try, but that appeal doesn't change anything." "I appreciate the effort, but that's not going to cut it."
- If you're accepting the appeal (raising scores): Acknowledge they made a good point, but do it YOUR way. Make contextually relevant jokes or clever observations. Even when you're giving them points, maintain your sharp personality. Examples: "Alright, you know what? You've got a point there. I'll give you that." "Okay, I see what you mean—that's actually fair." "You know what, you're right. I was being too harsh."

EXAMPLES OF BAD (TOO TAME):
- "The appeal is considered but the score remains the same."
- "The score is adjusted based on the appeal."
- "The appeal provides additional context."

Each reasoning should focus ONLY on its respective adjective and the appeal's relevance to that specific category. Be entertaining, sharp, and memorable. Your jokes should be contextually relevant to the answer, adjectives, and appeal.

Respond ONLY with strict JSON in this shape (no extra text, no commentary):
{"newScore1": <integer >= originalScore1 and <= 10>, "newScore2": <integer >= originalScore2 and <= 10>, "accepted": <true_if_either_score_increased_else_false>, "reasoning1": "<1-2 short sentences for adjective1>", "reasoning2": "<1-2 short sentences for adjective2>"}`.trim();
}

function parseAppealResponse(
  raw: string,
  originalScore1: number,
  originalScore2: number,
): { newScore1: number; newScore2: number; reasoning1: string; reasoning2: string; accepted: boolean } {
  // Try JSON parse first
  try {
    const parsed = JSON.parse(raw) as {
      newScore1?: number;
      newScore2?: number;
      accepted?: boolean;
      reasoning1?: string;
      reasoning2?: string;
    };

    if (typeof parsed.newScore1 === "number" && typeof parsed.newScore2 === "number") {
      const base1 = Math.max(originalScore1, parsed.newScore1);
      const base2 = Math.max(originalScore2, parsed.newScore2);
      const clamped1 = Math.min(10, Math.max(originalScore1, Math.round(base1)));
      const clamped2 = Math.min(10, Math.max(originalScore2, Math.round(base2)));
      const accepted = clamped1 > originalScore1 || clamped2 > originalScore2 || parsed.accepted === true;
      return {
        newScore1: clamped1,
        newScore2: clamped2,
        reasoning1: parsed.reasoning1?.toString() || "",
        reasoning2: parsed.reasoning2?.toString() || "",
        accepted,
      };
    }
  } catch {
    // ignore and fall through
  }

  // Fallback regex parsing
  const match1 = raw.match(/"newScore1"\s*:\s*(\d)/i);
  const match2 = raw.match(/"newScore2"\s*:\s*(\d)/i);
  const numeric1 = match1 ? Number(match1[1]) : originalScore1;
  const numeric2 = match2 ? Number(match2[1]) : originalScore2;
  const clamped1 = Math.min(10, Math.max(originalScore1, Math.round(numeric1)));
  const clamped2 = Math.min(10, Math.max(originalScore2, Math.round(numeric2)));

  const reasoning1Match = raw.match(/"reasoning1"\s*:\s*"([\s\S]*?)"/i);
  const reasoning2Match = raw.match(/"reasoning2"\s*:\s*"([\s\S]*?)"/i);
  const reasoning1 = reasoning1Match ? reasoning1Match[1] : "";
  const reasoning2 = reasoning2Match ? reasoning2Match[1] : "";

  const accepted = clamped1 > originalScore1 || clamped2 > originalScore2;

  return { newScore1: clamped1, newScore2: clamped2, reasoning1, reasoning2, accepted };
}
