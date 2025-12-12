// Base adjective list for Off the Charts.
// Developers can freely edit / expand this list over time.
// Keep adjectives fairly common, concrete, and evocative.

export const BASE_ADJECTIVES: string[] = [
  "agile",
  "alien",
  "ancient",
  "animated",
  "apathetic",
  "aromatic",
  "awkward",
  "barren",
  "basic",
  "bitter",
  "bold",
  "bouncy",
  "breezy",
  "bright",
  "brilliant",
  "brittle",
  "bubbly",
  "chaotic",
  "charming",
  "cheerful",
  "clever",
  "cloudy",
  "clumsy",
  "colorful",
  "confused",
  "cozy",
  "curious",
  "dangerous",
  "delicate",
  "dramatic",
  "elusive",
  "energetic",
  "ethereal",
  "fearless",
  "fiery",
  "flexible",
  "flimsy",
  "fluffy",
  "foggy",
  "fragile",
  "frantic",
  "frozen",
  "gentle",
  "ghostly",
  "gigantic",
  "gloomy",
  "glorious",
  "graceful",
  "greedy",
  "gritty",
  "groovy",
  "grumpy",
  "guilty",
  "harsh",
  "haunting",
  "hectic",
  "helpless",
  "heroic",
  "hidden",
  "hollow",
  "hopeful",
  "hungry",
  "icy",
  "immense",
  "impatient",
  "infinite",
  "intense",
  "invisible",
  "jagged",
  "jaunty",
  "jittery",
  "joyful",
  "lazy",
  "legendary",
"lonely",
"loud",
"lush",
  "magical",
  "massive",
"melodic",
"messy",
"mighty",
"moody",
  "mysterious",
  "nervous",
  "noisy",
  "nostalgic",
  "odd",
  "orderly",
  "ornate",
  "overwhelming",
  "peaceful",
  "playful",
  "pointless",
  "polished",
  "powerful",
"prickly",
"proud",
"puzzling",
"restless",
  "rigid",
  "rough",
"rowdy",
"rusty",
"scattered",
"shallow",
  "sharp",
  "shiny",
  "silky",
"silly",
"sleepy",
"slippery",
"sluggish",
"smooth",
"soft",
"spacious",
"speedy",
  "spiky",
  "spooky",
  "spotless",
  "squishy",
  "stale",
  "steep",
  "sticky",
"sturdy",
"subtle",
"suspicious",
  "swift",
  "tangled",
  "tasty",
  "tense",
  "thick",
  "thin",
  "thrilling",
"tidy",
"timid",
"tiny",
"transparent",
"tricky",
  "twisted",
  "unsteady",
  "vague",
  "vast",
 "velvety",
 "vibrant",
 "villainous",
 "warm",
 "watery",
 "weightless",
 "wild",
 "windy",
 "witty",
 "youthful",
 "cringe",
 "wholesome",
 "Chaotic Good",
 "True Neutral",
 "Chaotic Evil",
 "edgy",
 "cyberpunk",
 "sci-fi",
 "dystopian",
 "underdog",
 "rebellious",
 "nerd",
 "jock",
 "futuristic",
 "prehistoric",
 "hardcore",
 "spicy",
 "iconic",
 "underrated",
 "overrated",
 "doomed",
 "experimental",
 "impractical",
 "memes",
 "zany",
 "zippy",
];

// Preset daily puzzles for the first 14 days (starting Dec 10, 2025)
const PRESET_PAIRS: [string, string][] = [
  ["sticky", "nostalgic"],
  ["gigantic", "hopeful"],
  ["slippery", "clever"],
  ["frozen", "dramatic"],
  ["aromatic", "mysterious"],
  ["jagged", "cheerful"],
  ["weightless", "heroic"],
  ["rusty", "nostalgic"],
  ["brittle", "hopeful"],
  ["spacious", "lonely"],
  ["smooth", "guilty"],
  ["sharp", "peaceful"],
  ["fluffy", "rebellious"],
  ["transparent", "dramatic"],
];

const PRESET_START_DATE = "2025-12-10"; // YYYY-MM-DD format

// Deterministic daily selection based on date string (YYYY-MM-DD).
// This is intentionally simple and local only – not a global daily seed.
export function pickDailyAdjectives(
  dateKey: string,
  count: number,
  pool: string[] = BASE_ADJECTIVES,
): string[] {
  // Extract the date part (before the version suffix)
  const dateMatch = dateKey.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!dateMatch) {
    // Fallback to random if date format is unexpected
    return pickRandomAdjectives(count, pool);
  }
  
  const dateStr = dateMatch[1];
  const startDate = new Date(PRESET_START_DATE);
  const currentDate = new Date(dateStr);
  
  // Calculate days since preset start
  const daysDiff = Math.floor((currentDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  
  // If within the 14-day preset window, return the preset pair
  if (daysDiff >= 0 && daysDiff < PRESET_PAIRS.length) {
    const preset = PRESET_PAIRS[daysDiff];
    if (preset && preset.length === count) {
      return [...preset];
    }
  }
  
  // Otherwise, use random selection
  return pickRandomAdjectives(count, pool, dateKey);
}

function pickRandomAdjectives(
  count: number,
  pool: string[],
  dateKey?: string,
): string[] {
  const adjectives = [...pool];
  if (adjectives.length <= count) return adjectives;

  // Simple hash of the date string (or use current time if no dateKey)
  const seed = dateKey || Date.now().toString();
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }

  const result: string[] = [];
  for (let i = 0; i < count; i++) {
    hash = (hash * 1664525 + 1013904223) >>> 0; // LCG
    const idx = hash % adjectives.length;
    result.push(adjectives[idx]);
    adjectives.splice(idx, 1);
  }

  return result;
}
