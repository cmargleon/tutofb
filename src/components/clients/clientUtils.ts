export { INPUT_CLASS as INPUT_BASE } from '../ui';

export const summarizePrompt = (prompt: string | null | undefined): string | null => {
  const trimmed = prompt?.trim();
  if (!trimmed) return null;
  return trimmed.length > 180 ? `${trimmed.slice(0, 177)}...` : trimmed;
};
