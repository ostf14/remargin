// Open Library cover lookup — a keyless, lenient fallback for when Google Books
// returns no cover (its anonymous quota 429s easily and many volumes lack imageLinks).
// Returns undefined on no match / any error — never throws, so it can't break an import.
export async function fetchOpenLibraryCover(
  title: string,
  author?: string,
): Promise<string | undefined> {
  try {
    const t = title.trim();
    if (!t || t.toLowerCase() === 'untitled') return undefined;

    const params = new URLSearchParams({ title: t, limit: '1', fields: 'cover_i' });
    const a = author?.trim();
    if (a && a.toLowerCase() !== 'unknown author') params.set('author', a);
    const url = `https://openlibrary.org/search.json?${params.toString()}`;

    const res = await fetch(url);
    if (!res.ok) {
      console.log('[gbooks] openlibrary HTTP error:', res.status, res.statusText);
      return undefined;
    }
    const json = (await res.json()) as { docs?: { cover_i?: number }[] };
    const coverId = json.docs?.[0]?.cover_i;
    console.log('[gbooks] openlibrary cover_i:', coverId);
    if (!coverId || coverId < 0) return undefined;

    // -L = large (~up to 1000px); default=false → 404 (not a blank placeholder) if missing.
    return `https://covers.openlibrary.org/b/id/${coverId}-L.jpg?default=false`;
  } catch (e) {
    console.log('[gbooks] openlibrary error:', e);
    return undefined;
  }
}
