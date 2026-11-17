import JSZip from 'jszip';
import type { Document, Element } from '@xmldom/xmldom';
import {
	childElements,
	firstChild,
	listParagraphs,
	paragraphText,
	parseXml,
	segments,
	serializeXml,
	setText,
	splitKey,
	wEl
} from './xml.ts';

export interface Replacement {
	/** Paragraph key `<part>#<index>`. */
	para: string;
	start: number;
	end: number;
	value: string;
}

const contentKids = (run: Element) => childElements(run).filter((k) => k.nodeName !== 'w:rPr');

/**
 * Make `pos` a run boundary: split the run whose content spans `pos` in two
 * (both halves keep the run properties). No-op at a boundary or the paragraph end.
 */
function splitAt(doc: Document, p: Element, pos: number) {
	const seg = segments(p).find((s) => s.start <= pos && pos < s.start + s.text.length);
	if (!seg) return;
	const offset = pos - seg.start;
	const run = seg.run;
	const kids = contentKids(run);
	const idx = kids.indexOf(seg.node);
	if (offset === 0 && idx === 0) return;

	const right = run.cloneNode(true) as Element;
	const rightKids = contentKids(right);
	for (let i = idx + 1; i < kids.length; i++) run.removeChild(kids[i]);
	if (offset > 0) setText(doc, seg.node, seg.text.slice(0, offset));
	else run.removeChild(seg.node);
	for (let i = 0; i < idx; i++) right.removeChild(rightKids[i]);
	if (offset > 0) setText(doc, rightKids[idx], seg.text.slice(offset));
	run.parentNode!.insertBefore(right, run.nextSibling);
}

/** Text with `\n` → `<w:br/>` and `\t` → `<w:tab/>`. */
function appendValue(doc: Document, run: Element, value: string) {
	value.split('\n').forEach((line, i) => {
		if (i) run.appendChild(wEl(doc, 'br'));
		line.split('\t').forEach((chunk, j) => {
			if (j) run.appendChild(wEl(doc, 'tab'));
			if (!chunk) return;
			const t = wEl(doc, 't');
			setText(doc, t, chunk);
			run.appendChild(t);
		});
	});
}

/**
 * Replace characters `[start, end)` of paragraph `p` with `value`. The value takes the
 * formatting of the first replaced character; the example's highlight (the yellow /
 * green marker colours) is dropped.
 */
export function replaceRange(doc: Document, p: Element, start: number, end: number, value: string) {
	const text = paragraphText(p);
	if (start < 0 || end > text.length || start >= end) return;
	// An empty value must not leave a double space behind.
	if (!value && text[end] === ' ' && (start === 0 || text[start - 1] === ' ')) end += 1;

	splitAt(doc, p, end);
	splitAt(doc, p, start);
	const runs = [
		...new Set(
			segments(p)
				.filter((s) => s.start >= start && s.start < end)
				.map((s) => s.run)
		)
	];
	if (!runs.length) return;

	const [first, ...rest] = runs;
	for (const k of contentKids(first)) first.removeChild(k);
	const rPr = firstChild(first, 'w:rPr');
	const hl = firstChild(rPr, 'w:highlight');
	if (rPr && hl) rPr.removeChild(hl);
	appendValue(doc, first, value);
	for (const r of rest) r.parentNode?.removeChild(r);
}

/** Apply replacements to one XML part. Ranges must not overlap. */
export function fillPartXml(
	xml: string,
	reps: { index: number; start: number; end: number; value: string }[]
) {
	const doc = parseXml(xml);
	const paras = listParagraphs(doc);
	// right to left, so earlier offsets in the same paragraph stay valid
	const sorted = [...reps].sort((a, b) => a.index - b.index || b.start - a.start);
	for (const r of sorted) {
		const p = paras[r.index];
		if (p) replaceRange(doc, p, r.start, r.end, r.value);
	}
	return serializeXml(doc);
}

/** Fill a .docx: every replacement swaps a text range for its value, formatting kept. */
export async function fillDocx(data: Uint8Array, replacements: Replacement[]): Promise<Uint8Array> {
	const zip = await JSZip.loadAsync(data);
	const byPart = new Map<string, { index: number; start: number; end: number; value: string }[]>();
	for (const r of replacements) {
		const { part, index } = splitKey(r.para);
		if (!byPart.has(part)) byPart.set(part, []);
		byPart.get(part)!.push({ index, start: r.start, end: r.end, value: r.value });
	}
	for (const [part, reps] of byPart) {
		const file = zip.file(part);
		if (!file) continue;
		zip.file(part, fillPartXml(await file.async('string'), reps));
	}
	return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
