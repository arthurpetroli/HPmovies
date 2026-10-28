/** Optional aliases must fit the source API contract; truncation changes identity. */
export function normalizedTitleHints(titles?: string[]): string[] {
  return [...new Set((titles ?? []).map(title => title.trim()).filter(title => title.length > 0 && title.length <= 200
    && ![...title].some(char => char.charCodeAt(0) < 32)))].slice(0, 5);
}
