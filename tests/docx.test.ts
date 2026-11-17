import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { fillDocx, fillPartXml } from '../src/lib/server/docx/fill.ts';
import { buildPreview } from '../src/lib/server/docx/preview.ts';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const doc = (body: string) =>
	`<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${body}</w:body></w:document>`;
const B = '<w:rPr><w:b/></w:rPr>';
const HL = '<w:rPr><w:highlight w:val="yellow"/></w:rPr>';

async function makeDocx(body: string) {
	const zip = new JSZip();
	zip.file('[Content_Types].xml', '<Types/>');
	zip.file('word/document.xml', doc(body));
	return zip.generateAsync({ type: 'uint8array' });
}

const texts = async (data: Uint8Array) => Object.values((await buildPreview(data)).text);

describe('preview', () => {
	it('numbers paragraphs (also in tables) and concatenates runs, tabs and breaks', async () => {
		const data = await makeDocx(
			`<w:p><w:r><w:t>Hello </w:t></w:r><w:r>${B}<w:t>world</w:t><w:tab/><w:t>!</w:t><w:br/></w:r></w:p>` +
				'<w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
		);
		const pv = await buildPreview(data);
		expect(pv.text).toEqual({
			'word/document.xml#0': 'Hello world\t!\n',
			'word/document.xml#1': 'cell'
		});
		const p = pv.parts[0].blocks[0];
		expect(p.t === 'p' && p.runs).toEqual([{ text: 'Hello ' }, { text: 'world\t!\n', b: true }]);
	});
});

describe('fill', () => {
	const fill = (
		body: string,
		reps: { index?: number; start: number; end: number; value: string }[]
	) =>
		fillPartXml(
			doc(body),
			reps.map((r) => ({ index: 0, ...r }))
		);
	const textOf = (xml: string) =>
		[...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>|<w:(tab|br)\/>/g)]
			.map((m) => m[1] ?? (m[2] === 'tab' ? '\t' : '\n'))
			.join('');

	it('replaces a range inside one run', () => {
		const out = fill('<w:p><w:r><w:t>Іван ПЕТРЕНКО прибув</w:t></w:r></w:p>', [
			{ start: 5, end: 13, value: 'КОВАЛЕНКО' }
		]);
		expect(textOf(out)).toBe('Іван КОВАЛЕНКО прибув');
	});

	it('replaces across runs, keeping the first run formatting and dropping highlight', () => {
		const body = `<w:p><w:r><w:t>Солдат </w:t></w:r><w:r><w:rPr><w:b/><w:highlight w:val="yellow"/></w:rPr><w:t>ПЕТ</w:t></w:r><w:r>${HL}<w:t>РЕНКО</w:t></w:r><w:r><w:t> І.</w:t></w:r></w:p>`;
		const out = fill(body, [{ start: 7, end: 15, value: 'КОВАЛЕНКО' }]);
		expect(textOf(out)).toBe('Солдат КОВАЛЕНКО І.');
		expect(out).toContain(
			'<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">КОВАЛЕНКО</w:t></w:r>'
		);
		expect(out).not.toContain('highlight');
	});

	it('applies several ranges in one paragraph and writes line breaks', () => {
		const out = fill('<w:p><w:r><w:t>A=1, B=2.</w:t></w:r></w:p>', [
			{ start: 2, end: 3, value: 'x\ny' },
			{ start: 7, end: 8, value: '42' }
		]);
		expect(textOf(out)).toBe('A=x\ny, B=42.');
	});

	it('swallows a doubled space when the value is empty', () => {
		const out = fill('<w:p><w:r><w:t>старший солдат ПЕТРЕНКО</w:t></w:r></w:p>', [
			{ start: 0, end: 7, value: '' }
		]);
		expect(textOf(out)).toBe('солдат ПЕТРЕНКО');
	});

	it('fills a whole .docx by paragraph key', async () => {
		const data = await makeDocx(
			'<w:p><w:r><w:t>one</w:t></w:r></w:p><w:p><w:r><w:t>two three</w:t></w:r></w:p>'
		);
		const out = await fillDocx(data, [
			{ para: 'word/document.xml#1', start: 4, end: 9, value: '3' }
		]);
		expect(await texts(out)).toEqual(['one', 'two 3']);
	});
});
