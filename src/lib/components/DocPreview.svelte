<script lang="ts" module>
	export interface HighlightRange {
		id: string;
		start: number;
		end: number;
		kind: 'own' | 'inherited' | 'hint';
		title?: string;
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

	interface Props {
		preview: DocPreview;
		/** Highlights per paragraph key. Marks (own/inherited) win over hints. */
		ranges: Record<string, HighlightRange[]>;
		/** Highlight ids drawn with an outline (selected mark / field). */
		active?: Set<string>;
		onselect?: (s: SelectionInfo) => void;
		onrangeclick?: (id: string, rect: DOMRect) => void;
		onerror?: (msg: string) => void;
	}

	let { preview, ranges, active = new Set(), onselect, onrangeclick, onerror }: Props = $props();

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

	const LABEL = { header: 'Верхній колонтитул', footer: 'Нижній колонтитул', footnotes: 'Виноски', body: '' };
</script>

{#snippet paragraph(p: PreviewParagraph)}
	<!-- no whitespace between inline nodes: it would shift character offsets -->
	<p data-pkey={p.key} style={paraStyle(p)}>{#each groups(p) as g, gi (gi)}{#if g.range}<span class={rangeClass(g.range)} data-range={g.range.id} title={g.range.title}>{#each g.pieces as pc (pc.start)}<span data-off={pc.start} style={runStyle(pc.run, true)}>{pc.text}</span>{/each}</span>{:else}{#each g.pieces as pc (pc.start)}<span data-off={pc.start} style={runStyle(pc.run, false)}>{pc.text}</span>{/each}{/if}{/each}</p>
{/snippet}

{#snippet blocks(list: PreviewBlock[])}
	{#each list as b, i (i)}
		{#if b.t === 'p'}
			{@render paragraph(b)}
		{:else}
			<table>
				<tbody>
					{#each b.rows as row, ri (ri)}
						<tr>
							{#each row as cell, ci (ci)}
								<td colspan={cell.span} class:merged={cell.merged} style={cell.width ? `width:${cell.width}pt` : ''}>
									{#if !cell.merged}{@render blocks(cell.blocks)}{/if}
								</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	{/each}
{/snippet}

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
	bind:this={root}
	class="docx"
	style:max-width={preview.pageWidth ? `${preview.pageWidth + 96}pt` : undefined}
	{onmouseup}
	{onclick}
>
	{#each preview.parts as part (part.name)}
		{#if part.kind !== 'body'}
			<div class="part-label">{LABEL[part.kind]}</div>
		{/if}
		<div class:aside={part.kind !== 'body'}>{@render blocks(part.blocks)}</div>
	{/each}
</div>

<style>
	.docx {
		font-family: 'Times New Roman', Times, serif;
		font-size: 12pt;
		line-height: 1.25;
		background: white;
		padding: 48pt;
		margin: 0 auto;
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.12);
		color: #111;
	}
	.docx p {
		white-space: pre-wrap;
		tab-size: 4;
		min-height: 1.25em;
		overflow-wrap: anywhere;
	}
	.docx table {
		border-collapse: collapse;
		width: 100%;
		margin: 4pt 0;
	}
	.docx td {
		border: 1px solid #cbd5e1;
		padding: 2pt 4pt;
		vertical-align: top;
	}
	.docx td.merged {
		border-top-color: transparent;
	}
	.part-label {
		font-family: ui-sans-serif, system-ui, sans-serif;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #94a3b8;
		margin-top: 12pt;
	}
	.aside {
		border: 1px dashed #e2e8f0;
		padding: 4pt;
		font-size: 0.9em;
	}
	.mk {
		cursor: pointer;
		border-radius: 2px;
		box-decoration-break: clone;
		-webkit-box-decoration-break: clone;
	}
	.mk.own {
		background: #fde68a;
		box-shadow: inset 0 -2px 0 #d97706;
	}
	.mk.inherited {
		background: #bbf7d0;
		box-shadow: inset 0 -2px 0 #16a34a;
	}
	.mk.hint {
		background: none;
		box-shadow: none;
		text-decoration: underline dashed #7c3aed;
		text-underline-offset: 3px;
		cursor: pointer;
	}
	.mk.active {
		outline: 2px solid #2563eb;
		outline-offset: 1px;
	}
</style>
