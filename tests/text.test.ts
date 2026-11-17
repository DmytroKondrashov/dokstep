import { describe, expect, it } from 'vitest';
import { documentPreview, fillDocument, formatOf } from '../src/lib/server/documents.ts';
import { outputFilename } from '../src/lib/server/engine.ts';
import { decodeText } from '../src/lib/server/text.ts';

const utf8 = (s: string) => new TextEncoder().encode(s);
const BOM = [0xef, 0xbb, 0xbf];

/** Windows-1251 bytes for Cyrillic test strings (А–я, Ії, Її, Єє, Ґґ). */
function cp1251(s: string) {
	const extra: Record<string, number> = {
		І: 0xb2,
		і: 0xb3,
		Ї: 0xaf,
		ї: 0xbf,
		Є: 0xaa,
		є: 0xba,
		Ґ: 0xa5,
		ґ: 0xb4
	};
	return new Uint8Array(
		[...s].map((ch) => {
			const c = ch.codePointAt(0)!;
			if (extra[ch]) return extra[ch];
			if (c >= 0x410 && c <= 0x44f) return c - 0x410 + 0xc0;
			return c;
		})
	);
}

describe('.txt documents', () => {
	it('recognises formats by extension', () => {
		expect(formatOf('Довідка.TXT')).toBe('txt');
		expect(formatOf('Наказ.docx')).toBe('docx');
		expect(formatOf('scan.pdf')).toBeNull();
	});

	it('reads UTF-8, UTF-8 with BOM and Windows-1251', () => {
		expect(decodeText(utf8('Привіт')).text).toBe('Привіт');
		expect(decodeText(new Uint8Array([...BOM, ...utf8('Привіт')]))).toEqual({
			text: 'Привіт',
			bom: true
		});
		expect(decodeText(cp1251('Довідка про їжу'))).toEqual({ text: 'Довідка про їжу', bom: true });
	});

	it('previews one paragraph per line', async () => {
		const pv = await documentPreview('txt', utf8('Довідка\r\nПетренко Олена\r\n\tкінець'));
		expect(pv.plain).toBe(true);
		expect(pv.text).toEqual({
			'text#0': 'Довідка',
			'text#1': 'Петренко Олена',
			'text#2': '\tкінець'
		});
	});

	it('fills ranges, keeps CRLF, writes multi-line values with the file line ending', async () => {
		const src = utf8('Видано: Петренко Олена\r\nАдреса: вул. Зелена\r\nДата: 20.11.2026\r\n');
		const out = await fillDocument('txt', src, [
			{ para: 'text#0', start: 8, end: 22, value: 'Шевчук Максим' },
			{ para: 'text#1', start: 8, end: 19, value: 'м. Київ,\nвул. Січова, 3' },
			{ para: 'text#2', start: 6, end: 16, value: '28.12.2026' }
		]);
		expect(new TextDecoder().decode(out)).toBe(
			'Видано: Шевчук Максим\r\nАдреса: м. Київ,\r\nвул. Січова, 3\r\nДата: 28.12.2026\r\n'
		);
	});

	it('writes UTF-8 (with BOM) for a Windows-1251 example and drops double spaces of empty values', async () => {
		const out = await fillDocument('txt', cp1251('старший солдат Петренко'), [
			{ para: 'text#0', start: 0, end: 7, value: '' }
		]);
		expect([...out.subarray(0, 3)]).toEqual(BOM);
		expect(new TextDecoder().decode(out.subarray(3))).toBe('солдат Петренко');
	});

	it('names generated files with the document extension', () => {
		const doc = { id: 'd', name: 'Довідка', format: 'txt' as const, outputName: 'Довідка {ПІБ}' };
		const steps = [
			{
				id: 's',
				name: 's',
				docs: [doc],
				fields: [{ id: 'f', label: 'ПІБ', example: '' }],
				marks: []
			}
		];
		expect(outputFilename(doc, steps, { f: 'Шевчук' })).toBe('Довідка Шевчук.txt');
		expect(outputFilename({ ...doc, format: undefined }, steps, { f: 'Шевчук' })).toBe(
			'Довідка Шевчук.docx'
		);
	});
});
