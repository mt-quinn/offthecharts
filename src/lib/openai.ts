import { OpenAI } from "openai";

let cachedClient: OpenAI | null = null;

export function getOpenAIClient() {
  if (!cachedClient) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not set in the environment");
    }

    cachedClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  return cachedClient;
}

export const DEFAULT_MODEL_ID =
  process.env.OFF_THE_CHARTS_MODEL_ID || "gpt-5.1-2025-11-13";
