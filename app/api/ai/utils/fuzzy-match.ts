// app/api/ai/utils/fuzzy-match.ts
// Extracted from the existing leads/chat/route.ts — shared across all tools

/**
 * Fuzzy match an input string against a list of valid options.
 * Returns the best matching option or null if no match found.
 *
 * Match priority:
 *   1. Exact (case-insensitive)
 *   2. Starts-with (either direction)
 *   3. Contains (either direction)
 *   4. Word overlap
 */
export function fuzzyMatch(input: string, options: string[]): string | null {
  if (!input || options.length === 0) return null;
  const lower = input.toLowerCase().trim();

  // 1. Exact match
  const exact = options.find((o) => o.toLowerCase() === lower);
  if (exact) return exact;

  // 2. Starts-with match
  const startsWith = options.find(
    (o) =>
      o.toLowerCase().startsWith(lower) || lower.startsWith(o.toLowerCase())
  );
  if (startsWith) return startsWith;

  // 3. Contains match (either direction)
  const contains = options.find(
    (o) => o.toLowerCase().includes(lower) || lower.includes(o.toLowerCase())
  );
  if (contains) return contains;

  // 4. Word overlap match
  const inputWords = lower.split(/\s+/);
  let bestMatch: string | null = null;
  let bestScore = 0;
  for (const option of options) {
    const optWords = option.toLowerCase().split(/\s+/);
    const overlap = inputWords.filter((w) =>
      optWords.some((ow) => ow.includes(w) || w.includes(ow))
    ).length;
    if (overlap > bestScore) {
      bestScore = overlap;
      bestMatch = option;
    }
  }
  if (bestScore > 0) return bestMatch;

  return null;
}

/**
 * Fuzzy match a value against dropdown options loaded from the DB.
 * Returns { matched: true, value: "exact option" } or { matched: false, value: original }
 */
export function fuzzyMatchDropdown(
  input: string,
  options: string[]
): { matched: boolean; value: string } {
  if (!input) return { matched: false, value: input };
  if (options.length === 0) return { matched: true, value: input }; // No options loaded yet, accept as-is

  const match = fuzzyMatch(input, options);
  if (match) {
    return { matched: true, value: match };
  }
  return { matched: false, value: input };
}