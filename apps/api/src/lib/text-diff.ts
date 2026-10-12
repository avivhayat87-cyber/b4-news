// Comparing the AI's first version with what the editor published: the raw
// material of the learning loop.
import { createTwoFilesPatch, diffWords } from 'diff';

/** 0 = published exactly as the AI wrote it, 1 = nothing of the AI's text survived. */
export function editRatio(aiText: string, finalText: string): number {
  if (!aiText && !finalText) return 0;
  let changed = 0;
  for (const part of diffWords(aiText, finalText)) {
    if (part.added || part.removed) changed += part.value.length;
  }
  const ratio = changed / (aiText.length + finalText.length);
  return Math.min(1, Math.max(0, Math.round(ratio * 1000) / 1000));
}

export function unifiedDiff(aiText: string, finalText: string): string {
  return createTwoFilesPatch('ai', 'final', `${aiText}\n`, `${finalText}\n`, '', '', { context: 2 });
}
