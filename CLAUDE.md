# Dokstep — notes for agents

- SvelteKit 3 (config lives in `vite.config.ts`, no svelte.config.js), Svelte 5 runes, TS, Tailwind 4, Biome (tabs, single quotes).
- Import app modules via the `#lib/*` subpath with a `.js` extension (`#lib/types.js`); relative imports inside `src/lib/server` use `.ts`.
- The paragraph/offset model in `src/lib/server/docx/xml.ts` is shared by preview and fill. Any change to how text atoms are counted invalidates stored marks.
- In `DocPreview.svelte`, keep paragraph markup free of whitespace between inline nodes; extra text nodes shift offsets.
- UI text is Ukrainian.
- Verify with `npm run check && npx biome lint . && npm test`.
