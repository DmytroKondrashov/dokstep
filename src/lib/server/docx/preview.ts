import JSZip from 'jszip';
import type { Element } from '@xmldom/xmldom';
import type {
	DocPreview,
	PreviewBlock,
	PreviewCell,
	PreviewParagraph,
	PreviewPart,
	PreviewRun
} from '#lib/types.js';
import {
	childElements,
	contentParts,
	firstChild,
	flag,
	listParagraphs,
	paragraphKey,
	paragraphText,
	parseXml,
	partKind,
	prop,
	segments
} from './xml.ts';

const twipsToPt = (v: string | null) => (v ? Math.round(Number(v) / 20) : undefined);

/** Build the editor's preview model of a .docx (text, basic formatting, tables). */
export async function buildPreview(data: Uint8Array): Promise<DocPreview> {
	const zip = await JSZip.loadAsync(data);
	const preview: DocPreview = { parts: [], text: {} };

	for (const name of contentParts(Object.keys(zip.files))) {
		const doc = parseXml(await zip.file(name)!.async('string'));
		const paras = listParagraphs(doc);
		const keys = new Map<Element, string>();
		paras.forEach((p, i) => {
			const key = paragraphKey(name, i);
			keys.set(p, key);
			preview.text[key] = paragraphText(p);
		});

		const kind = partKind(name);
		const root = doc.documentElement!;
		let containers: Element[] = [root];
		if (kind === 'body') {
			const body = firstChild(root, 'w:body');
			containers = body ? [body] : [];
			const sect = body && firstChild(body, 'w:sectPr');
			if (sect) {
				const w = Number(firstChild(sect, 'w:pgSz')?.getAttribute('w:w') ?? 0);
				const mar = firstChild(sect, 'w:pgMar');
				const l = Number(mar?.getAttribute('w:left') ?? 0);
				const r = Number(mar?.getAttribute('w:right') ?? 0);
				if (w) preview.pageWidth = Math.round((w - l - r) / 20);
			}
		} else if (kind === 'footnotes') {
			containers = childElements(root).filter(
				(f) => f.nodeName === 'w:footnote' && !f.getAttribute('w:type')
			);
		}

		const blocks = containers.flatMap((c) => renderChildren(c, keys));
		if (blocks.some(hasText)) preview.parts.push({ name, kind, blocks } satisfies PreviewPart);
	}
	return preview;
}

function hasText(b: PreviewBlock): boolean {
	if (b.t === 'p') return b.runs.some((r) => r.text.trim());
	return b.rows.some((row) => row.some((c) => c.blocks.some(hasText)));
}

function renderChildren(el: Element, keys: Map<Element, string>): PreviewBlock[] {
	const out: PreviewBlock[] = [];
	for (const c of childElements(el)) {
		if (c.nodeName === 'w:p') {
			const key = keys.get(c);
			if (key) out.push(renderParagraph(c, key));
		} else if (c.nodeName === 'w:tbl') {
			out.push(renderTable(c, keys));
		} else if (c.nodeName === 'w:sdt') {
			const content = firstChild(c, 'w:sdtContent');
			if (content) out.push(...renderChildren(content, keys));
		} else if (c.nodeName === 'w:customXml') {
			out.push(...renderChildren(c, keys));
		}
	}
	return out;
}

function renderParagraph(p: Element, key: string): PreviewParagraph {
	const runs: PreviewRun[] = [];
	let last: Element | null = null;
	for (const s of segments(p)) {
		if (s.run === last) {
			runs[runs.length - 1].text += s.text;
			continue;
		}
		last = s.run;
		runs.push({ text: s.text, ...runFormat(firstChild(s.run, 'w:rPr')) });
	}

	const pPr = firstChild(p, 'w:pPr');
	const para: PreviewParagraph = { t: 'p', key, runs };
	const jc = prop(pPr, 'w:jc');
	if (jc === 'center') para.align = 'center';
	else if (jc === 'right' || jc === 'end') para.align = 'right';
	else if (jc === 'both' || jc === 'distribute') para.align = 'both';
	const ind = firstChild(pPr, 'w:ind');
	if (ind) {
		para.indLeft = twipsToPt(ind.getAttribute('w:left') || ind.getAttribute('w:start'));
		const first = twipsToPt(ind.getAttribute('w:firstLine'));
		const hanging = twipsToPt(ind.getAttribute('w:hanging'));
		para.indFirst = first ?? (hanging ? -hanging : undefined);
	}
	const sp = firstChild(pPr, 'w:spacing');
	if (sp) {
		para.spaceBefore = twipsToPt(sp.getAttribute('w:before'));
		para.spaceAfter = twipsToPt(sp.getAttribute('w:after'));
	}
	return para;
}

function runFormat(rPr: Element | null): Omit<PreviewRun, 'text'> {
	if (!rPr) return {};
	const f: Omit<PreviewRun, 'text'> = {};
	if (flag(rPr, 'w:b')) f.b = true;
	if (flag(rPr, 'w:i')) f.i = true;
	if (flag(rPr, 'w:u')) f.u = true;
	if (flag(rPr, 'w:strike')) f.strike = true;
	const sz = prop(rPr, 'w:sz');
	if (sz) f.sz = Number(sz) / 2;
	const color = prop(rPr, 'w:color');
	if (color && color !== 'auto' && color !== '000000') f.color = `#${color}`;
	const hl = prop(rPr, 'w:highlight');
	if (hl && hl !== 'none') f.highlight = hl;
	else {
		const fill = firstChild(rPr, 'w:shd')?.getAttribute('w:fill');
		if (fill && fill !== 'auto' && fill !== 'FFFFFF') f.highlight = `#${fill}`;
	}
	return f;
}

function renderTable(tbl: Element, keys: Map<Element, string>): PreviewBlock {
	const rows: PreviewCell[][] = [];
	for (const tr of childElements(tbl).filter((c) => c.nodeName === 'w:tr')) {
		const cells: PreviewCell[] = [];
		for (const tc of childElements(tr)) {
			// cells can be wrapped in content controls
			const tcs =
				tc.nodeName === 'w:tc'
					? [tc]
					: tc.nodeName === 'w:sdt'
						? childElements(firstChild(tc, 'w:sdtContent')!).filter((x) => x.nodeName === 'w:tc')
						: [];
			for (const cell of tcs) {
				const tcPr = firstChild(cell, 'w:tcPr');
				const span = Number(prop(tcPr, 'w:gridSpan') || 1);
				const vMerge = prop(tcPr, 'w:vMerge');
				const w = firstChild(tcPr, 'w:tcW');
				cells.push({
					blocks: renderChildren(cell, keys),
					span: span > 1 ? span : undefined,
					merged: vMerge !== null && vMerge !== 'restart' ? true : undefined,
					width: w?.getAttribute('w:type') === 'dxa' ? twipsToPt(w.getAttribute('w:w')) : undefined
				});
			}
		}
		rows.push(cells);
	}
	return { t: 'tbl', rows };
}
