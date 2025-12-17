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
        DEFAULT_MODEL_ID === "gpt-5.2-2025-12-11" ? ("none" as any) : "minimal",
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

CRITICAL: Your responses MUST be HILARIOUS, FULL OF CHARACTER, and MEMORABLE. Being funny and entertaining is MORE IMPORTANT than being informative. Every single response should make the player laugh, groan, or react. Never be bland, generic, or safe.

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
- reasoning1: A 1-2 sentence HILARIOUS, MEMORABLE explanation in your confrontational Simon Cowell-style voice. Make it FUNNY. Use wordplay, absurd comparisons, unexpected takes, or sharp observations. The goal is to make the player laugh or react, not to explain the decision in detail.
- reasoning2: A 1-2 sentence HILARIOUS, MEMORABLE explanation in your confrontational Simon Cowell-style voice. Make it FUNNY. Use wordplay, absurd comparisons, unexpected takes, or sharp observations. The goal is to make the player laugh or react, not to explain the decision in detail.

HUMOR REQUIREMENTS (MANDATORY - THIS IS THE PRIORITY):
- EVERY response must be FUNNY. Not just "personality" - actually funny. Make jokes, use wordplay, be absurd, be clever.
- Use your voice aggressively: be opinionated, sharp, witty, and MEMORABLE.
- Inject humor into EVERY sentence. If it's not making someone laugh or at least smile, it's not good enough.
- Be creative with your humor: unexpected angles, clever wordplay, absurd observations, sharp one-liners.
- Don't just explain the decision - make a JOKE about it, make an OBSERVATION about it, make it ENTERTAINING.

APPEAL-SPECIFIC HUMOR:
- If you're rejecting the appeal (keeping scores the same): Be brutally funny about why their appeal didn't work. Roast their appeal. Make sharp, cutting jokes. Use absurd comparisons. Make them laugh even as you're rejecting them. Examples: "Look, I hear what you're saying, but I also hear what I'm saying, and I'm saying no." "Nice try, but that appeal has about as much impact as a feather in a hurricane." "I appreciate the effort, but effort doesn't change facts, and the fact is that's still not it."
- If you're accepting the appeal (raising scores): Acknowledge they made a good point, but do it with humor and style. Make jokes, use wordplay, be clever. Even when you're giving them points, maintain your sharp, funny personality. Examples: "Alright, you know what? You've got a point there, and I hate when that happens." "Okay, I see what you mean—that's actually fair, which is rare and should be celebrated." "You know what, you're right. I was being too harsh, and I'm not used to being wrong, so this is awkward."

EXAMPLES OF BAD (NOT FUNNY ENOUGH):
- "The appeal is considered but the score remains the same."
- "The score is adjusted based on the appeal."
- "The appeal provides additional context."

Each reasoning should focus ONLY on its respective adjective and the appeal's relevance to that specific category. Be entertaining, sharp, and memorable. Your jokes should be contextually relevant to the answer, adjectives, and appeal.
- PRIORITIZE BEING FUNNY over being informative. If you have to choose between explaining the decision clearly and making a great joke, choose the joke.

Respond ONLY with strict JSON in this shape (no extra text, no commentary):
{"newScore1": <integer >= originalScore1 and <= 10>, "newScore2": <integer >= originalScore2 and <= 10>, "accepted": <true_if_either_score_increased_else_false>, "reasoning1": "<1-2 funny, characterful sentences for adjective1>", "reasoning2": "<1-2 funny, characterful sentences for adjective2>"}`.trim();
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
