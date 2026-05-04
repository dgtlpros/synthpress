/**
 * Zero-dependency class name utility.
 * Filters out falsy values and joins the rest with spaces.
 */
export function cn(...inputs: (string | boolean | undefined | null)[]): string {
  return inputs.filter(Boolean).join(" ");
}
