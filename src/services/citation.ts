// Format a selected passage as a copyable citation:
//   "quote" — Author, *Title*, locator
// Locator is reader-specific: "с. 42" for PDF pages, the chapter name for EPUB.
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
