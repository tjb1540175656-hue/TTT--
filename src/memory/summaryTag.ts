/** 只读取正文中明确标记的摘要，不猜测普通叙事文本。 */
export function extractSummaryTag(text: string): string {
  if (!text) return '';
  return [...text.matchAll(/<summary>([\s\S]*?)<\/summary>/gi)]
    .map(match => match[1].trim())
    .filter(Boolean)
    .join('\n\n');
}
