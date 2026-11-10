export { INPUT_CLASS as INPUT_BASE } from '../ui';

export const summarizePrompt = (prompt: string | null | undefined): string | null => {
  const trimmed = prompt?.trim();
  if (!trimmed) return null;
  return trimmed.length > 180 ? `${trimmed.slice(0, 177)}...` : trimmed;
};

/** Two-letter monogram for avatars (decorative; always rendered aria-hidden). */
export const clientInitials = (name: string): string => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words[0].charAt(0) + words[1].charAt(0) : name.trim().slice(0, 2);
  return letters.toLocaleUpperCase('es') || '··';
};
