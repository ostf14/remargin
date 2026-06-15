# ReMargin — Product Specification

## 1. Product Vision

Cross-platform e-book reader built around marginalia. Read deeply, annotate on the margins, export everything to Markdown. Web-first, designed for people who read academic and non-fiction texts and want their notes to be portable, structured, and beautiful.

---

## 2. User Flows

### 2.1 First Launch
- User opens the app → empty library with a prominent "Add Book" button/dropzone
- No onboarding, no sign-up — the app is immediately usable

### 2.2 Adding a Book
- Click "+" button or drag-and-drop file onto library
- Supported formats: EPUB, PDF
- App extracts metadata (title, author) and cover image automatically
- Book appears in library grid immediately after import
- User stays in library (does not auto-open the book)

### 2.3 Reading
- Click book cover → reader opens
- Reader remembers last position per book
- Reading controls: page navigation, zoom (PDF only), display mode switching
- Close reader → return to library

### 2.4 Highlighting
- Select text → color picker appears (5 preset colors)
- Tap a color → highlight is saved
- Highlight persists across sessions
- Clicking an existing highlight → options to change color, add note, or delete

### 2.5 Margin Notes (Core Feature)
- After highlighting, user clicks "Add note" → text input appears in the right margin
- Note appears visually on the right margin, connected to its highlight by a thin line (Google Docs comment model)
- If multiple notes are close vertically → they stack downward, each line still pointing to its highlight
- Notes are truncated with "show more" if long
- Notes can be edited and deleted at any time
- Right panel toggle: show/hide all notes for current book as a scrollable list

### 2.6 Bookmarks
- One bookmark per book = reading progress marker
- Automatically saved on every page turn / scroll stop
- Shown as percentage in library view and reader toolbar

### 2.7 Export
- Each annotation exports as an individual .md file
- "Export all" bundles all annotations of a book
- YAML frontmatter per file:
  ```yaml
  ---
  book: "Title"
  author: "Author Name"
  page: 42
  quote: "The exact highlighted text"
  date_created: 2025-01-15
  date_modified: 2025-01-16
  color: yellow
  tags: []
  ---
  
  My margin note text goes here.
  ```
- Export triggers browser download (single file or .zip for "export all")

### 2.8 App State Restoration
- On reopen, user sees exactly where they left off
- If last state was library → library
- If last state was reading page 47 of a book → that exact page

---

## 3. Screens & Layout

### 3.1 Library Screen
- **Grid of book covers** with title and author below each cover
- Covers have subtle shadow, hover effect (lift + stronger shadow)
- Visual style inspired by GOG Galaxy — warm, inviting, personal collection feel
- **Top bar:** search input, sort dropdown (title, author, date added, progress), theme toggle
- **Add button:** prominent "+" or dropzone area
- **Book context menu** (right-click or long-press): delete (with confirmation), view info
- **Book metadata:** title, author, tags/themes (e.g. "sociology", "philosophy", "linguistics") — editable
- **Progress indicator** on each cover (small bar or percentage badge)

### 3.2 Reader Screen
- **Layout:** book content centered, right margin area for notes
- **Top toolbar:** back button, book title, progress %, display mode switcher, zoom controls (PDF only), font size +/- (EPUB only), notes panel toggle
- **Bottom:** page indicator (e.g. "Page 42 of 316" for PDF, "Chapter 3 — 34%" for EPUB)
- **Right margin:** margin notes connected by lines to highlights in text
- **Notes panel** (toggleable): full list of all annotations for current book, scrollable, clicking an annotation navigates to its location

---

## 4. Interactions

### 4.1 Display Modes (both EPUB and PDF)
1. **Scroll** — continuous vertical scroll
2. **Paginated** — single page, swipe/click to turn
3. **Two-page spread** — side by side like an open book
4. **Page flip animation** — skeuomorphic page turn effect

### 4.2 Zoom (PDF only)
- **Ctrl + mouse wheel:** continuous zoom toward cursor position (Figma-style — point under cursor stays fixed)
- **Buttons:** "−" (step −0.25) and "+" (step +0.25)
- **Fit width button:** reset to fit-width
- **Range:** 50% to 300%
- **Implementation:** instant visual zoom via CSS transform, debounced canvas re-render after 300ms of no zoom activity. On re-render: no visible jump, no scroll position loss, no intermediate flicker. The canvas must already be at its final size when transform resets to scale(1).
- **Scroll:** when zoomed beyond fit-width, container scrolls both axes
- **Pinch-to-zoom:** future (mobile)

### 4.3 EPUB Typography
- **No customization** — one curated, ideal preset:
  - Serif body font (e.g. Literata, Merriweather, or Charter)
  - Comfortable line-height (~1.6)
  - Generous margins
  - Optimal line length (~65-75 characters)
- **Exception:** font size increase/decrease buttons for accessibility (±2px steps, reasonable range)
- Philosophy: "don't let users accidentally make their books ugly" — like Apple's approach

### 4.4 Text Selection & Highlighting
- **EPUB:** native browser selection works, select text → highlight color picker popover appears above selection
- **PDF:** custom highlight layer (not native ::selection). Selection via TextLayer spans → custom div overlay for visual highlight (solid colored rectangles per line, no word-level gaps)
- **Copy from PDF:** intercepted via onCopy handler, cleaned of line-break artifacts (soft hyphens removed, single line breaks → spaces, double line breaks preserved)
- **5 highlight colors:** yellow, green, blue, red, purple (expandable later)
- Highlights persist in storage, re-rendered on page load

### 4.5 Margin Notes
- **Creation:** highlight text → "Add note" button in popover → text input opens in right margin at the vertical position of the highlight
- **Display:** note card in right margin, thin line connecting to highlight. Note card shows truncated text with "show more" for long notes
- **Multiple notes near each other:** stack vertically downward, each with its own connector line to its highlight
- **Editing:** click note card → inline editing
- **Deletion:** click delete icon on note card → confirmation → removed
- **Panel view:** toggle button in toolbar opens right sidebar with all annotations listed chronologically, each clickable to navigate to location

### 4.6 Navigation
- **Page turn:** left/right arrow keys, on-screen arrow buttons, swipe (future/mobile)
- **PDF:** Prev/Next page buttons, direct page number input
- **EPUB:** Prev/Next section, chapter navigation via native TOC if available
- **Back to library:** back button in toolbar, Escape key

### 4.7 Keyboard Shortcuts
- `←` / `→` — previous / next page
- `Escape` — back to library
- `Ctrl + mouse wheel` — zoom (PDF)
- `Ctrl + 0` — fit width (PDF)
- `Ctrl + +` / `Ctrl + -` — font size (EPUB)

---

## 5. Data Model

### 5.1 Book
```typescript
interface Book {
  id: string;                    // UUID
  title: string;
  author: string;
  coverUrl: string | null;       // base64 data URL or object URL
  format: 'epub' | 'pdf';
  tags: string[];                // user-defined: "sociology", "philosophy", etc.
  progress: number;              // 0-100
  lastPosition: string | null;   // CFI (epub) or page number string (pdf)
  lastOpened: string | null;     // ISO date
  addedAt: string;               // ISO date
}
```

### 5.2 Annotation
```typescript
interface Annotation {
  id: string;                    // UUID
  bookId: string;
  type: 'highlight' | 'note';   // highlight = color only, note = highlight + text
  anchor: EpubAnchor | PdfAnchor;
  highlightedText: string;       // the quoted text
  note: string;                  // user's margin note (empty for highlight-only)
  color: HighlightColor;
  createdAt: string;             // ISO date
  updatedAt: string;             // ISO date
}

interface EpubAnchor {
  kind: 'epub';
  cfi: string;                   // EPUB CFI for precise location
  chapter: string;               // chapter title for display
}

interface PdfAnchor {
  kind: 'pdf';
  page: number;
  rects: Array<{                 // highlight rectangles in page coordinates
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
}

type HighlightColor = 'yellow' | 'green' | 'blue' | 'red' | 'purple';
```

### 5.3 App State
```typescript
interface AppState {
  lastView: 'library' | 'reader';
  lastBookId: string | null;     // if lastView is 'reader'
  theme: 'dark' | 'light';
  epubFontSizeOffset: number;    // default 0, range -4 to +8
}
```

### 5.4 Storage Architecture
- **IndexedDB:** book files (ArrayBuffer), cover images
- **localStorage:** book metadata, annotations, app state, settings
- **All access through `src/services/storage.ts`** — single point of replacement for future Google Drive sync
- Components and hooks NEVER access storage directly

### 5.5 Export Format
Each annotation → individual `.md` file.

Filename: `{book-title-slug}_{page}_{annotation-id-short}.md`

```markdown
---
book: "Reassembling the Social"
author: "Bruno Latour"
page: 42
quote: "The exact highlighted text from the book"
color: yellow
date_created: 2025-01-15
date_modified: 2025-01-16
tags: []
---

My margin note text goes here. This is what I wrote on the margin while reading.
```

"Export all" → .zip containing all .md files for the book, named `{book-title-slug}_annotations.zip`.

---

## 6. Visual Design

### 6.1 Theme
- **Dark theme** (default): deep background (#1a1a1a range), warm text (#e8e4df range), subtle warm accents
- **Light theme:** off-white background, dark text, same accent palette
- Toggle in library top bar and reader toolbar

### 6.2 Typography
- **UI headings:** serif font (e.g. Playfair Display, DM Serif Display)
- **UI body/controls:** clean sans-serif (e.g. Inter, DM Sans)
- **EPUB reading font:** curated serif (Literata, Merriweather, or Charter) — not customizable
- **PDF:** rendered as-is from the document

### 6.3 Library Design
- GOG Galaxy inspiration: covers are the hero element
- Subtle shadow on covers, lift on hover
- Warm, personal, "your collection" feeling
- Progress shown as thin bar at bottom of cover card
- Clean grid with generous spacing

### 6.4 Reader Design
- Content centered with generous margins (especially right margin for notes)
- Minimal chrome — toolbar fades or minimizes when reading
- Highlight colors are semi-transparent overlays
- Margin note cards: subtle background, small text, thin connector line to highlight
- Notes panel: clean list, each item shows quote snippet + note preview

### 6.5 Animations & Transitions
- **Every** size/position/opacity change: transition minimum 0.15s ease-out
- Page flip animation (display mode option): CSS/JS skeuomorphic effect
- No visible jumps on state changes (zoom, page turn, panel toggle)
- Loading states: subtle skeleton or spinner, never blank screen

---

## 7. UX Quality Standards

### 7.1 Before Writing Code
- What will the user SEE and FEEL? Walk through the interaction mentally, frame by frame
- What does this change break? Every change has side effects — identify them before coding
- Am I fixing the root cause or a symptom? If the fix feels like a workaround — stop, find the real problem

### 7.2 While Writing Code
- Optimistic UI, lazy compute: visual feedback must be instant, heavy work debounced/deferred
- Every async operation needs: loading state, error handling, cancellation of stale operations, and cleanup on unmount
- State changes must be atomic: if two things must update together, they update in one render. No intermediate broken states visible to the user

### 7.3 Before Committing
- "First use" test: imagine opening this feature for the first time with no context. Does it make sense? Does anything flash, jump, or feel broken?
- Rapid input test: what happens if the user does this action 5 times in 1 second?
- Empty/error test: what happens with no data, corrupted data, or a failure?
- Remove all console.log and debug code

---

## 8. Edge Cases & Error States

### 8.1 File Import
- Unsupported format → clear error message, not a crash
- Corrupted file → "Could not open this file" with option to remove from library
- Duplicate file (same title+author) → warn user, allow or skip
- Very large file (>100MB) → show progress indicator during import

### 8.2 Storage
- IndexedDB full → warn user, suggest removing books
- localStorage quota → graceful degradation, warn user

### 8.3 Reader
- PDF with no extractable text (scanned, image-only) → render as images, disable highlighting, show notice
- EPUB with broken formatting → render best-effort, don't crash
- Very long book (1000+ pages) → lazy loading, don't load all pages at once

---

## 9. Platform & Responsive

### 9.1 Current Scope
- **Web application** (SPA on Vercel)
- **Primary target:** desktop browsers (Chrome, Firefox, Safari, Edge)
- **Mobile browsers:** functional but not optimized in MVP

### 9.2 Future
- Mobile-optimized responsive layout
- Tauri desktop wrapper (native feel, offline, system tray)
- Tauri mobile (Android/iOS) — especially for stylus/handwriting
- Pinch-to-zoom on touch devices

---

## 10. Future Scope (NOT in MVP)

### 10.1 Handwriting Input
- Stylus/pen input for margin notes (S Pen, Apple Pencil)
- Handwritten annotations stored as stroke data
- Rendered inline on margins
- This is a core future feature, not an afterthought — architecture should not block it

### 10.2 Google Drive Sync
- Sync annotations, progress, and metadata via Google Drive
- Book files optionally synced (user choice — large files)
- Conflict resolution strategy TBD
- storage.ts is the single replacement point

### 10.3 Additional Formats
- fb2 (important for Russian-language audience)
- DJVU
- CBZ/CBR (comics)

### 10.4 Advanced Library
- Collections / folders
- Smart filters (unread, in progress, finished)
- Reading statistics (pages per day, time spent)

### 10.5 Social / Collaboration
- Share annotations (export link, not real-time collab)
- Import annotations from others

### 10.6 AI Integration
- Summarize highlights
- Generate questions from annotations
- Chat with book context

---

## 11. Technical Constraints

### 11.1 Stack
- Vite + React 19 + TypeScript
- epub.js for EPUB rendering
- pdfjs-dist v4 for PDF rendering
- CSS Modules (no Tailwind)
- IndexedDB for file storage, localStorage for metadata
- Vercel for deployment

### 11.2 Architecture Rules
- All storage access through `src/services/storage.ts` only
- Functional components, hooks for logic
- No `any` types — all interfaces in `src/types/`
- Named exports for components, default export for pages

### 11.3 Performance
- First meaningful paint < 1s
- Book open < 500ms (metadata from localStorage, file from IndexedDB)
- Page turn < 100ms perceived (pre-render next page)
- Zoom: visual response < 16ms (CSS transform), re-render < 300ms debounced

---

## Appendix A: MVP Checklist

### Must Have (launch blocker)
- [ ] Library grid with covers
- [ ] Import EPUB and PDF (file picker + drag-and-drop)
- [ ] EPUB reader with curated typography preset
- [ ] PDF reader with zoom (smooth, no jumps)
- [ ] Text highlighting (5 colors) in both formats
- [ ] Margin notes (right side, connected by lines)
- [ ] Notes panel (list all annotations)
- [ ] Export annotations to .md (individual + zip)
- [ ] Reading progress tracking
- [ ] App state restoration (where you left off)
- [ ] Dark + light theme
- [ ] Book deletion with confirmation

### Should Have (soon after launch)
- [ ] Display modes: scroll, paginated, two-page, page flip
- [ ] Library search and sort
- [ ] Book tags/themes
- [ ] Font size adjustment for EPUB
- [ ] Keyboard shortcuts

### Nice to Have (later)
- [ ] Duplicate detection on import
- [ ] Book metadata editing
- [ ] Reading statistics
