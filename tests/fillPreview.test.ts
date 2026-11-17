import { describe, expect, it } from 'vitest';
import { fillPreview } from '../src/lib/fillPreview.ts';
import type { DocPreview } from '../src/lib/types.ts';

const pv: DocPreview = {
	text: { 'd#0': 'Прийняти ПЕТРЕНКО Олену з 01.12.2026.' },
	parts: [
		{
			name: 'd',
			kind: 'body',
			blocks: [
				{
					t: 'p',
					key: 'd#0',
					runs: [
						{ text: 'Прийняти ' },
						{ text: 'ПЕТРЕНКО', b: true, highlight: 'green' },
						{ text: ' Олену', highlight: 'green' },
						{ text: ' з 01.12.2026.' }
					]
				}
			]
		}
	]
};

describe('fillPreview', () => {
	it('replaces ranges across runs, keeps first-run formatting, reports new offsets', () => {
		const { preview, ranges } = fillPreview(pv, [
			{ id: 'a', para: 'd#0', start: 9, end: 23, value: 'ШЕВЧУКА Максима', label: 'ПІБ' },
			{ id: 'b', para: 'd#0', start: 26, end: 36, value: '', label: 'Дата початку' }
		]);
		const p = preview.parts[0].blocks[0];
		expect(p.t === 'p' && p.runs).toEqual([
			{ text: 'Прийняти ' },
			{ text: 'ШЕВЧУКА Максима', b: true },
			{ text: ' з ' },
			{ text: '[Дата початку]' },
			{ text: '.' }
		]);
		expect(preview.text['d#0']).toBe('Прийняти ШЕВЧУКА Максима з [Дата початку].');
		expect(ranges['d#0']).toEqual([
			{ id: 'a', start: 9, end: 24, kind: 'filled', title: 'ПІБ' },
			{ id: 'b', start: 27, end: 41, kind: 'empty', title: 'Дата початку' }
		]);
	});
});
