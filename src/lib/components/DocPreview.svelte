<script lang="ts" module>
	export interface HighlightRange {
		id: string;
		start: number;
		end: number;
		/** own/inherited/hint in the editor; filled/empty in a run's live preview. */
		kind: 'own' | 'inherited' | 'hint' | 'filled' | 'empty';
		title?: string;
	}

	/** A note in the page margin next to the paragraph a mark is in. */
	export interface MarginNote {
		/** Id of the highlight it belongs to (clicking the note = clicking the mark). */
		id: string;
		kind: 'own' | 'inherited' | 'hint';
		label: string;
		detail?: string;
	}

	export interface SelectionInfo {
		para: string;
		start: number;
		end: number;
		text: string;
		rect: DOMRect;
	}
</script>

<script lang="ts">
	import type { DocPreview, PreviewBlock, PreviewParagraph, PreviewRun } from '#lib/types.js';
	import Icon from './Icon.svelte';

	interface Props {
		preview: DocPreview;
		/** Highlights per paragraph key. Marks (own/inherited) win over hints. */
		ranges: Record<string, HighlightRange[]>;
		/** Highlight ids drawn with an outline (selected mark / field). */
		active?: Set<string>;
		/** Margin notes per paragraph key; when given, the sheet gets a margin column. */
		notes?: Record<string, MarginNote[]>;
		onselect?: (s: SelectionInfo) => void;
		onrangeclick?: (id: string, rect: DOMRect) => void;
		onerror?: (msg: string) => void;
	}

	let {
		preview,
		ranges,
		active = new Set(),
		notes,
		onselect,
		onrangeclick,
		onerror
	}: Props = $props();

	interface Piece {
		text: string;
		start: number;
		run: PreviewRun;
	}
	interface Group {
		range?: HighlightRange;
		pieces: Piece[];
	}

	/** Split the paragraph's runs at highlight boundaries and group pieces by highlight. */
	function groups(p: PreviewParagraph): Group[] {
		const rs = [...(ranges[p.key] ?? [])].sort((a, b) => a.start - b.start);
		const at = (pos: number) =>
			rs.find((r) => r.kind !== 'hint' && r.start <= pos && pos < r.end) ??
			rs.find((r) => r.start <= pos && pos < r.end);
		const cuts = new Set<number>();
		for (const r of rs) cuts.add(r.start).add(r.end);

		const out: Group[] = [];
		let pos = 0;
		for (const run of p.runs) {
			let i = 0;
			while (i < run.text.length) {
				let j = i + 1;
				while (j < run.text.length && !cuts.has(pos + j)) j++;
				const piece = { text: run.text.slice(i, j), start: pos + i, run };
				const range = at(pos + i);
				const last = out[out.length - 1];
				if (last && last.range === range) last.pieces.push(piece);
				else out.push({ range, pieces: [piece] });
				i = j;
			}
			pos += run.text.length;
		}
		return out;
	}

	const HL: Record<string, string> = {
		yellow: '#fef08a',
		green: '#bbf7d0',
		cyan: '#a5f3fc',
		magenta: '#f5d0fe',
		blue: '#bfdbfe',
		red: '#fecaca',
		lightGray: '#e5e7eb',
		darkYellow: '#fde68a',
		darkGreen: '#86efac'
	};

	function runStyle(r: PreviewRun, marked: boolean): string {
		const s: string[] = [];
		if (r.b) s.push('font-weight:bold');
		if (r.i) s.push('font-style:italic');
		const deco = [r.u && 'underline', r.strike && 'line-through'].filter(Boolean).join(' ');
		if (deco) s.push(`text-decoration:${deco}`);
		if (r.sz) s.push(`font-size:${r.sz}pt`);
		if (r.color) s.push(`color:${r.color}`);
		if (r.highlight && !marked) {
			const c = r.highlight.startsWith('#') ? r.highlight : (HL[r.highlight] ?? '#fef9c3');
			// the example's own highlight, faded so marks stand out
			s.push(`background:color-mix(in srgb, ${c} 40%, transparent)`);
		}
		return s.join(';');
	}

	function paraStyle(p: PreviewParagraph): string {
		const s: string[] = [];
		if (p.align) s.push(`text-align:${p.align === 'both' ? 'justify' : p.align}`);
		if (p.indLeft) s.push(`margin-left:${p.indLeft}pt`);
		if (p.indFirst) s.push(`text-indent:${p.indFirst}pt`);
		s.push(`margin-top:${Math.min(p.spaceBefore ?? 0, 24)}pt`);
		s.push(`margin-bottom:${Math.min(p.spaceAfter ?? 0, 24)}pt`);
		return s.join(';');
	}

	const rangeClass = (r: HighlightRange) => `mk ${r.kind}${active.has(r.id) ? ' active' : ''}`;

	/* ---------- selection → (paragraph, offsets) ---------- */

	let root: HTMLElement;

	function firstText(node: Node, last = false): Text | null {
		const w = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
		let t: Text | null = null;
		while (w.nextNode()) {
			t = w.currentNode as Text;
			if (!last) return t;
		}
		return t;
	}

	function locate(node: Node, offset: number): { key: string; off: number } | null {
		if (node.nodeType !== Node.TEXT_NODE) {
			const kids = node.childNodes;
			if (offset < kids.length) {
				const t = firstText(kids[offset]);
				return t ? locate(t, 0) : null;
			}
			const t = firstText(node, true);
			return t ? locate(t, t.length) : null;
		}
		const span = (node.parentElement as HTMLElement | null)?.closest<HTMLElement>('[data-off]');
		const para = span?.closest<HTMLElement>('[data-pkey]');
		if (!span || !para || !root.contains(para)) return null;
		return { key: para.dataset.pkey!, off: Number(span.dataset.off) + offset };
	}

	const alnum = (ch: string | undefined) => !!ch && /[\p{L}\p{N}'’ʼ]/u.test(ch);
	/** Part of a word for snapping: `.`/`-` count only inside one (05.08.2026, Ів-Франківськ). */
	const inWord = (t: string, i: number) =>
		alnum(t[i]) || (/[.\-]/.test(t[i] ?? '') && alnum(t[i - 1]) && alnum(t[i + 1]));

	function onmouseup(e: MouseEvent) {
		const sel = window.getSelection();
		if (!sel || sel.isCollapsed || !sel.rangeCount) return;
		const range = sel.getRangeAt(0);
		const a = locate(range.startContainer, range.startOffset);
		let b = locate(range.endContainer, range.endOffset);
		if (!a || !b) return;
		const text = preview.text[a.key] ?? '';
		// a triple click ends at offset 0 of the next paragraph
		if (b.key !== a.key && b.off === 0) b = { key: a.key, off: text.length };
		if (b.key !== a.key) {
			onerror?.('Виділіть фрагмент у межах одного абзацу.');
			return;
		}
		let start = Math.min(a.off, b.off);
		let end = Math.max(a.off, b.off);
		while (start < end && /\s/.test(text[start])) start++;
		while (end > start && /\s/.test(text[end - 1])) end--;
		// snap a half-selected word to the whole word (Shift/Alt keeps the exact range)
		if (!e.altKey && !e.shiftKey) {
			while (start > 0 && start < end && inWord(text, start - 1) && inWord(text, start)) start--;
			while (end < text.length && end > start && inWord(text, end - 1) && inWord(text, end)) end++;
		}
		if (start >= end) return;
		onselect?.({ para: a.key, start, end, text: text.slice(start, end), rect: range.getBoundingClientRect() });
	}

	function onclick(e: MouseEvent) {
		const sel = window.getSelection();
		if (sel && !sel.isCollapsed) return;
		const el = (e.target as HTMLElement).closest<HTMLElement>('[data-range]');
		if (el) onrangeclick?.(el.dataset.range!, el.getBoundingClientRect());
	}

	/** Paragraph keys inside a block (a table holds many). */
	function keysOf(b: PreviewBlock): string[] {
		if (b.t === 'p') return [b.key];
		return b.rows.flatMap((row) => row.flatMap((c) => c.blocks.flatMap(keysOf)));
	}
	const notesOf = (b: PreviewBlock) => (notes ? keysOf(b).flatMap((k) => notes[k] ?? []) : []);

	function onnote(e: MouseEvent, id: string) {
		onrangeclick?.(id, (e.currentTarget as HTMLElement).getBoundingClientRect());
	}

	/** Column width of the sheet: the page's text width plus the paper margins. */
	const sheetWidth = $derived(`${Math.round((preview.pageWidth ?? 482) * (4 / 3)) + 112}px`);

	const LABEL = { header: 'Верхній колонтитул', footer: 'Нижній колонтитул', footnotes: 'Виноски', body: '' };
</script>

{#snippet paragraph(p: PreviewParagraph)}
	<!-- no whitespace between inline nodes: it would shift character offsets -->
	<p data-pkey={p.key} style={paraStyle(p)}>{#each groups(p) as g, gi (gi)}{#if g.range}<span class={rangeClass(g.range)} data-range={g.range.id} title={g.range.title}>{#each g.pieces as pc (pc.start)}<span data-off={pc.start} style={runStyle(pc.run, true)}>{pc.text}</span>{/each}</span>{:else}{#each g.pieces as pc (pc.start)}<span data-off={pc.start} style={runStyle(pc.run, false)}>{pc.text}</span>{/each}{/if}{/each}</p>
{/snippet}

{#snippet block(b: PreviewBlock)}
	{#if b.t === 'p'}
		{@render paragraph(b)}
	{:else}
		<table>
			<tbody>
				{#each b.rows as row, ri (ri)}
					<tr>
						{#each row as cell, ci (ci)}
							<td colspan={cell.span} class:merged={cell.merged} style={cell.width ? `width:${cell.width}pt` : ''}>
								{#if !cell.merged}{#each cell.blocks as inner, ii (ii)}{@render block(inner)}{/each}{/if}
							</td>
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
{/snippet}

{#snippet note(n: MarginNote)}
	<button
		type="button"
		class="chip {n.kind === 'own' ? 'chip-own' : n.kind === 'inherited' ? 'chip-inh' : 'chip-hint'} cursor-pointer hover:brightness-[0.97]"
		class:ring-2={active.has(n.id)}
		class:ring-accent={active.has(n.id)}
		onclick={(e) => onnote(e, n.id)}
	>
		{#if n.kind === 'own'}<Icon name="pencil" size={13} stroke={2.2} />{:else if n.kind === 'inherited'}<Icon name="link" size={13} stroke={2.2} />{:else}<Icon name="sparkle" size={13} />{/if}
		<span class="truncate">{#if n.kind === 'hint'}Підказка: {/if}<b class="font-semibold">{n.label}</b>{#if n.detail}&nbsp;· {n.detail}{/if}</span>
	</button>
{/snippet}

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div bind:this={root} class="docx" {onmouseup} {onclick}>
	{#each preview.parts as part (part.name)}
		{#if part.kind !== 'body'}
			<div class="part-label" style:max-width={sheetWidth}>{LABEL[part.kind]}</div>
		{/if}
		{@const rows = part.blocks.length + 2}
		<div
			class="sheet"
			class:with-margin={!!notes}
			class:aside={part.kind !== 'body'}
			style:grid-template-columns={notes ? `minmax(0, ${sheetWidth}) minmax(180px, 248px)` : `minmax(0, ${sheetWidth})`}
		>
			<div class="paper" style:grid-row="1 / span {rows}" aria-hidden="true"></div>
			<div class="pad" style:grid-row="1"></div>
			{#each part.blocks as b, i (i)}
				<div class="cell" style:grid-row={i + 2}>{@render block(b)}</div>
				{#if notes}
					{@const ns = notesOf(b)}
					{#if ns.length}
						<div class="notes" style:grid-row={i + 2}>
							{#each ns as n (n.id)}
								<div class="note-row"><span class="tick {n.kind}" aria-hidden="true"></span>{@render note(n)}</div>
							{/each}
						</div>
					{/if}
				{/if}
			{/each}
			<div class="pad end" style:grid-row={rows}></div>
		</div>
	{/each}
</div>

<style>
	.docx {
		font-family: var(--font-paper);
		font-size: 12pt;
		line-height: 1.45;
		color: #111317;
	}
	.sheet {
		display: grid;
		column-gap: 14px;
		justify-content: center;
		margin: 0 auto 24px;
	}
	.paper {
		grid-column: 1;
		background: #fff;
		border-radius: 4px;
		box-shadow:
			0 1px 2px rgb(22 27 38 / 0.08),
			0 8px 24px rgb(22 27 38 / 0.06);
	}
	.pad {
		grid-column: 1;
		height: 48px;
	}
	.pad.end {
		height: 64px;
	}
	.cell {
		grid-column: 1;
		padding: 0 56px;
		min-width: 0;
	}
	.notes {
		grid-column: 2;
		align-self: start;
		display: flex;
		flex-direction: column;
		gap: 5px;
		padding-top: 2px;
		font-family: var(--font-sans);
		min-width: 0;
	}
	.note-row {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}
	.tick {
		flex: none;
		width: 12px;
		height: 1px;
		background: #b7c0cc;
	}
	.tick.hint {
		height: 0;
		background: none;
		border-top: 1px dashed var(--color-hint);
	}
	.aside .pad {
		height: 16px;
	}
	.aside .cell {
		font-size: 0.92em;
	}
	@media (max-width: 760px) {
		.sheet.with-margin {
			grid-template-columns: minmax(0, 1fr) !important;
		}
		.notes {
			display: none;
		}
		.cell {
			padding: 0 20px;
		}
	}
	.docx p {
		white-space: pre-wrap;
		tab-size: 4;
		min-height: 1.45em;
		overflow-wrap: anywhere;
		margin: 0;
	}
	.docx table {
		border-collapse: collapse;
		width: 100%;
		margin: 4pt 0;
	}
	.docx td {
		border: 1px solid #cbd2dc;
		padding: 2pt 4pt;
		vertical-align: top;
	}
	.docx td.merged {
		border-top-color: transparent;
	}
	.part-label {
		margin: 0 auto 6px;
		font-family: var(--font-sans);
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-muted);
	}
	.mk {
		cursor: pointer;
		border-radius: 2px;
		box-decoration-break: clone;
		-webkit-box-decoration-break: clone;
	}
	.mk.own {
		background: var(--color-own);
		box-shadow: inset 0 -2px 0 var(--color-own-line);
	}
	.mk.inherited {
		background: var(--color-inh);
		box-shadow: inset 0 -2px 0 var(--color-inh-line);
	}
	.mk.hint {
		text-decoration: underline dashed var(--color-hint);
		text-decoration-thickness: 2px;
		text-underline-offset: 4px;
	}
	.mk.filled {
		cursor: default;
		background: var(--color-accent-soft);
		box-shadow: inset 0 -2px 0 color-mix(in srgb, var(--color-accent) 55%, transparent);
	}
	.mk.empty {
		cursor: default;
		color: var(--color-own-ink);
		background: var(--color-own-soft);
		outline: 1px dashed var(--color-own-line);
		outline-offset: -1px;
		font-family: var(--font-sans);
		font-size: 0.85em;
	}
	.mk.active {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}
</style>
