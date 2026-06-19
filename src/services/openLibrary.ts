import { normalizeLookupTitle } from './googleBooks';

// Build the URL for a single search.json call.
function buildUrl(title: string, author?: string): string {
  const params = new URLSearchParams({ title, limit: '3', fields: 'cover_i' });
  const a = author?.trim();
  if (a && a.toLowerCase() !== 'unknown author') params.set('author', a);
  return `https://openlibrary.org/search.json?${params.toString()}`;
}

// Open Library cover lookup — a keyless, lenient fallback for when Google Books
// returns no cover (its anonymous quota 429s easily and many volumes lack imageLinks).
// Returns undefined on no match / any error — never throws, so it can't break an import.
//
// Filenames like "Buck-Morss_Susan_The_Origin_of_Negative_Dialectics.pdf" leave the
// real title buried behind author crud. After normalising (underscores → spaces, etc.)
// we retry the search by dropping the leading word each time, up to a few attempts —
// catches that pattern without needing to guess where the title actually starts.
export async function fetchOpenLibraryCover(
  title: string,
  author?: string,
): Promise<string | undefined> {
  const base = normalizeLookupTitle(title);
  if (!base || base.toLowerCase() === 'untitled') return undefined;

  const words = base.split(' ').filter(Boolean);
  // Attempts: full title, then shave one leading word per retry. Stop before the
  // remaining tail gets too short to be specific (≤2 words = noisy matches).
  const maxAttempts = Math.min(5, Math.max(1, words.length - 1));

  for (let i = 0; i < maxAttempts; i++) {
    const tryTitle = words.slice(i).join(' ');
    if (tryTitle.split(' ').length < 2) break;

    try {
      const res = await fetch(buildUrl(tryTitle, author));
      if (!res.ok) {
        console.log('[gbooks] openlibrary HTTP error:', res.status, res.statusText);
        return undefined;
      }
      const json = (await res.json()) as { docs?: { cover_i?: number }[] };
      const doc = json.docs?.find((d) => typeof d.cover_i === 'number' && d.cover_i > 0);
      if (doc?.cover_i) {
        console.log('[gbooks] openlibrary matched:', tryTitle, '→ cover_i', doc.cover_i);
        // -L = large (~up to 1000px); default=false → 404 (not a blank placeholder) if missing.
        return `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg?default=false`;
      }
    } catch (e) {
      console.log('[gbooks] openlibrary error:', e);
      return undefined;
    }
  }

  console.log('[gbooks] openlibrary: no cover for any title variant of', base);
  return undefined;
}
