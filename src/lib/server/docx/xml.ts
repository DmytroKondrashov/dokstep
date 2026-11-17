import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import type { Document, Element, Node } from '@xmldom/xmldom';

/**
 * The paragraph / character-offset model shared by the preview and the filler.
 *
 * Every `<w:p>` of a part (except text-box paragraphs) gets an index in document
 * order; its text is the concatenation of its own runs' atoms: `<w:t>` text, `<w:tab>`
 * as `\t`, `<w:br>`/`<w:cr>` as `\n`, `<w:noBreakHyphen>` as `-`. A mark stores
 * `(part#index, start, end)` in that text, so preview and filler must agree on it.
 */

export const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';

export function parseXml(xml: string): Document {
	return new DOMParser().parseFromString(xml, 'text/xml');
}

export function serializeXml(doc: Document): string {
	return new XMLSerializer().serializeToString(doc);
}

/** Parts that hold user-visible paragraphs, in reading order. */
export function contentParts(names: string[]): string[] {
	const pick = (re: RegExp) => names.filter((n) => re.test(n)).sort(naturalSort);
	return [
		...pick(/^word\/header\d*\.xml$/),
		...pick(/^word\/document\.xml$/),
		...pick(/^word\/footnotes\.xml$/),
		...pick(/^word\/footer\d*\.xml$/)
	];
}

function naturalSort(a: string, b: string) {
	return a.localeCompare(b, undefined, { numeric: true });
}

export function partKind(name: string): 'body' | 'header' | 'footer' | 'footnotes' {
	if (name.includes('header')) return 'header';
	if (name.includes('footer')) return 'footer';
	if (name.includes('footnotes')) return 'footnotes';
	return 'body';
}

export const paragraphKey = (part: string, index: number) => `${part}#${index}`;

export function splitKey(key: string): { part: string; index: number } {
	const i = key.lastIndexOf('#');
	return { part: key.slice(0, i), index: Number(key.slice(i + 1)) };
}

export function childElements(el: Node): Element[] {
	const out: Element[] = [];
	for (let c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) out.push(c as Element);
	return out;
}

function closest(el: Node, name: string): Element | null {
	for (let p = el.parentNode; p; p = p.parentNode) if (p.nodeName === name) return p as Element;
	return null;
}

const inTextbox = (el: Element) => closest(el, 'w:txbxContent') !== null;

/** All addressable paragraphs of a part, in document order. */
export function listParagraphs(doc: Document): Element[] {
	return Array.from(doc.getElementsByTagName('w:p')).filter((p) => !inTextbox(p));
}

/** Runs that belong to `p` itself (also inside hyperlinks / insertions / smart tags). */
export function ownRuns(p: Element): Element[] {
	return Array.from(p.getElementsByTagName('w:r')).filter((r) => closest(r, 'w:p') === p);
}

export interface Segment {
	run: Element;
	node: Element;
	text: string;
	/** Offset of the segment in the paragraph text. */
	start: number;
}

export function atomText(node: Element): string | null {
	switch (node.nodeName) {
		case 'w:t':
			return node.textContent ?? '';
		case 'w:tab':
			return '\t';
		case 'w:br':
		case 'w:cr':
			return '\n';
		case 'w:noBreakHyphen':
			return '-';
		default:
			return null;
	}
}

export function segments(p: Element): Segment[] {
	const out: Segment[] = [];
	let pos = 0;
	for (const run of ownRuns(p)) {
		for (const node of childElements(run)) {
			const text = atomText(node);
			if (text === null || text === '') continue;
			out.push({ run, node, text, start: pos });
			pos += text.length;
		}
	}
	return out;
}

export function paragraphText(p: Element): string {
	return segments(p)
		.map((s) => s.text)
		.join('');
}

export function setText(doc: Document, t: Element, text: string) {
	while (t.firstChild) t.removeChild(t.firstChild);
	t.appendChild(doc.createTextNode(text));
	t.setAttributeNS(XML_NS, 'xml:space', 'preserve');
}

export function wEl(doc: Document, name: string): Element {
	return doc.createElementNS(W_NS, `w:${name}`);
}

/** `w:val` of a direct child, e.g. `prop(rPr, 'w:sz')`. */
export function prop(
	parent: Element | null | undefined,
	name: string,
	attr = 'w:val'
): string | null {
	if (!parent) return null;
	const el = childElements(parent).find((c) => c.nodeName === name);
	if (!el) return null;
	return el.getAttribute(attr) ?? '';
}

/** On/off property (`<w:b/>`, `<w:b w:val="0"/>`). */
export function flag(parent: Element | null | undefined, name: string): boolean {
	const v = prop(parent, name);
	return v !== null && v !== '0' && v !== 'false' && v !== 'none';
}

export function firstChild(parent: Element | null | undefined, name: string): Element | null {
	if (!parent) return null;
	return childElements(parent).find((c) => c.nodeName === name) ?? null;
}
