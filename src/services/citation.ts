// Format a selected passage as a copyable citation:
//   "quote" — Author, *Title*, locator
// Locator is reader-specific: "p. 42" for paginated pages (EPUB section-local or PDF
// page). Empty locator is filtered out below.
export function formatCitation(
  rawText: string,
  book: { author: string; title: string },
  locator: string,
): string {
  const quote = rawText
    .replace(/(\w)-\n(\w)/g, '$1$2') // re-join words split by a hyphenated line break
    .replace(/\s+/g, ' ') // collapse remaining whitespace/newlines to single spaces
    .trim();
  const meta = [book.author.trim(), `*${book.title.trim()}*`, locator.trim()].filter(
    (part) => part && part !== '**',
  );
  return `"${quote}" — ${meta.join(', ')}`;
}
