# ReMargin

Полная спецификация продукта — в SPEC.md. Перед началом любой задачи прочитай соответствующую секцию SPEC.md.

## Quick Reference

- Stack: Vite + React 19 + TypeScript, epub.js, pdfjs-dist v4, CSS Modules
- Storage: IndexedDB (files), localStorage (metadata) — всё через src/services/storage.ts
- Deploy: Vercel (SPA)

## Engineering Principles

### Before writing code
- What will the user SEE and FEEL? Walk through the interaction mentally, frame by frame.
- What does this change break? Every change has side effects — identify them before coding.
- Am I fixing the root cause or a symptom? If the fix feels like a workaround — stop, find the real problem.

### While writing code
- Optimistic UI, lazy compute: visual feedback instant, heavy work debounced/deferred.
- Every async operation: loading state, error handling, cancellation, cleanup on unmount.
- State changes atomic: no intermediate broken states visible to user.

### Before committing
- "First use" test: does anything flash, jump, or feel broken?
- Rapid input test: what happens if user does this 5 times in 1 second?
- Empty/error test: what happens with no data or a failure?
- Remove all console.log and debug code.

## Current Status

See SPEC.md → Appendix A for MVP checklist with current progress.

## Rules

- Do NOT open browser or use Chrome MCP unless explicitly asked
- Do NOT touch features outside the current task scope
- Do NOT add console.log without removing before commit
- After each task: npx tsc --noEmit, npm run build, then commit and push
