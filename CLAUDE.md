# Dokstep — notes for agents

- SvelteKit 3 (config lives in `vite.config.ts`, no svelte.config.js), Svelte 5 runes, TS, Tailwind 4, Biome (tabs, single quotes).
- Import app modules via the `#lib/*` subpath with a `.js` extension (`#lib/types.js`); relative imports inside `src/lib/server` use `.ts`.
- The paragraph/offset model in `src/lib/server/docx/xml.ts` is shared by preview and fill. Any change to how text atoms are counted invalidates stored marks.
- In `DocPreview.svelte`, keep paragraph markup free of whitespace between inline nodes; extra text nodes shift offsets.
- Formats: `.docx` and `.txt` (one paragraph per line). Go through `src/lib/server/documents.ts` (`formatOf`, `documentPreview`, `fillDocument`) — never call the docx or text engine directly from routes. `StepDoc.format` missing = docx.
- UI text is Ukrainian.
- Design «Поля на берегах»: tokens live in `@theme` in `src/app.css` (Onest for UI, Tinos for documents, both self-hosted via @fontsource). Yellow = field typed on this step, green = from an earlier step, violet dashed = suggestion; always pair the colour with an icon. Use the shared classes (`btn`, `input`, `card`, `chip-*`, `pill`, `segmented`) and `Icon.svelte` instead of ad-hoc styles.
- Verify with `npm run check && npx biome lint . && npm test`.
