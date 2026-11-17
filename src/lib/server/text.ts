import type { DocPreview, PreviewParagraph } from '#lib/types.js';
import type { Replacement } from './docx/fill.ts';

/**
 * Plain-text documents. Every line is a paragraph (`text#<line>`), so marks, suggestions
 * and the live preview work exactly like for .docx. Line endings are kept; a value with
 * line breaks gets the file's own line ending.
 */

export const TEXT_PART = 'text';

interface Decoded {
	text: string;
	/** Write a UTF-8 BOM on output (input had one, or was not UTF-8 — helps old editors). */
	bom: boolean;
}

/** UTF-8 (with or without BOM), UTF-16 (by BOM), else Windows-1251 — common for Ukrainian files. */
export function decodeText(data: Uint8Array): Decoded {
	if (data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf)
		return { text: new TextDecoder('utf-8').decode(data.subarray(3)), bom: true };
	if (data[0] === 0xff && data[1] === 0xfe)
		return { text: new TextDecoder('utf-16le').decode(data.subarray(2)), bom: true };
	if (data[0] === 0xfe && data[1] === 0xff)
		return { text: new TextDecoder('utf-16be').decode(data.subarray(2)), bom: true };
	try {
		return { text: new TextDecoder('utf-8', { fatal: true }).decode(data), bom: false };
	} catch {
		return { text: new TextDecoder('windows-1251').decode(data), bom: true };
	}
}

function split(text: string) {
	const eol = text.match(/\r\n|\r|\n/)?.[0] ?? '\n';
	return { lines: text.split(/\r\n|\r|\n/), eol };
}

export function textPreview(data: Uint8Array): DocPreview {
	const { lines } = split(decodeText(data).text);
	const text: Record<string, string> = {};
	const blocks: PreviewParagraph[] = lines.map((line, i) => {
		const key = `${TEXT_PART}#${i}`;
		text[key] = line;
		return { t: 'p', key, runs: line ? [{ text: line }] : [] };
	});
	return { parts: [{ name: TEXT_PART, kind: 'body', blocks }], text, plain: true };
}

export function fillText(data: Uint8Array, replacements: Replacement[]): Uint8Array {
	const { text, bom } = decodeText(data);
	const { lines, eol } = split(text);
	const byLine = new Map<number, Replacement[]>();
	for (const r of replacements) {
		const i = Number(r.para.slice(r.para.lastIndexOf('#') + 1));
		if (!byLine.has(i)) byLine.set(i, []);
		byLine.get(i)!.push(r);
	}
	for (const [i, reps] of byLine) {
		let line = lines[i];
		if (line === undefined) continue;
		// right to left, so earlier offsets stay valid
		for (const r of [...reps].sort((a, b) => b.start - a.start)) {
			let { start, end } = r;
			if (start < 0 || end > line.length || start >= end) continue;
			// an empty value must not leave a double space behind
			if (!r.value && line[end] === ' ' && (start === 0 || line[start - 1] === ' ')) end += 1;
			line = line.slice(0, start) + r.value.replace(/\r\n|\r|\n/g, eol) + line.slice(end);
		}
		lines[i] = line;
	}
	const body = new TextEncoder().encode(lines.join(eol));
	if (!bom) return body;
	const out = new Uint8Array(body.length + 3);
	out.set([0xef, 0xbb, 0xbf]);
	out.set(body, 3);
	return out;
}
