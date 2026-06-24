# ReMargin

EPUB reader with margin annotations. Read, highlight, take notes — export everything as Markdown.

**[→ Open ReMargin](https://remargin-sage.vercel.app)**

![ReMargin screenshot](https://remargin-sage.vercel.app/og-image.png)

## What it does

ReMargin is a local-first web app for reading EPUB books and annotating them with highlights and margin notes. All data stays on your device. Export to Markdown for Obsidian, Notion, or any PKM workflow.

## Features

- **5-color highlights** with keyboard shortcuts (1–5)
- **Margin notes** with connector lines to highlighted text
- **Formatted citation copy** (Ctrl+Shift+C)
- **In-book search** with navigation
- **Reading surfaces** — light, sepia, dark
- **Cross-book annotation dashboard** (Notes view)
- **Export** — per-note Markdown with YAML frontmatter, per-book zip, bulk export
- **Global page numbering** via epub.js locations
- **Auto cover fetching** — Google Books → Open Library fallback
- **PWA** — installable, works offline
- **Mobile responsive** — bottom sheet annotations, swipe navigation

## Stack

- React 19 + TypeScript
- epub.js (rendering, pagination, annotations)
- IndexedDB (file storage) + localStorage (metadata)
- CSS Modules
- Vite
- Vercel

## Typography

- **UI**: Space Grotesk
- **Reading**: Newsreader
- **Logo**: DM Serif Display

## Architecture

~4500 lines TypeScript. Key components:

| Component | Lines | Role |
|-----------|-------|------|
| EpubReader | ~1000 | EPUB rendering, highlights, annotations, search |
| ReaderShell | ~400 | Immersive chrome, settings drawer, navigation |
| BookGrid | ~365 | Library, search, sort, grid/notes views |
| NotesView | ~250 | Cross-book annotation dashboard with export |

## Design decisions

- **Local-first**: IndexedDB for files, localStorage for metadata. No server, no auth, no lock-in.
- **epub.js native API**: After 8 failed rewrites of custom scroll/append logic, settled on `manager: 'continuous'` + `flow: 'scrolled'` — let the library do its job.
- **Margin notes as first-class**: Not hidden in a sidebar. Visible on the page margin with connector lines, like handwritten marginalia.
- **Export-first annotations**: Every highlight exports to Markdown with YAML frontmatter. Built for Obsidian/Zettelkasten workflows.

## Run locally

```bash
git clone https://github.com/ostf14/remargin
cd remargin
npm install
npm run dev
```

## License

MIT

---

Built by [Aleksandr Mihhailovski](https://mihhailovski-product-designer.vercel.app)
