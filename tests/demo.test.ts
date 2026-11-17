import { describe, expect, it } from 'vitest';
import { buildDemo } from '../src/lib/server/demo.ts';
import { fillDocx } from '../src/lib/server/docx/fill.ts';
import { buildPreview } from '../src/lib/server/docx/preview.ts';
import { resolveFields } from '../src/lib/server/engine.ts';
import { applyTransform } from '../src/lib/server/transform.ts';

describe('demo workflow «Прийняття на роботу»', () => {
	it('fills every document with new data, declined and formatted', async () => {
		const data: Record<string, Uint8Array> = {};
		const { steps, fieldIds } = await buildDemo((d) => {
			data[`doc${d.stepIndex}`] = d.data;
			return `doc${d.stepIndex}`;
		});
		expect(steps.map((s) => s.marks.length)).toEqual([8, 12, 14]);

		const values = {
			[fieldIds.company]: 'Веселка',
			[fieldIds.director]: 'Коваль Ірина Олегівна',
			[fieldIds.employee]: 'Шевчук Максим Сергійович',
			[fieldIds.address]: 'м. Київ, вул. Січова, 3',
			[fieldIds.position]: 'менеджер з продажу',
			[fieldIds.start]: '05.01.2027',
			[fieldIds.appDate]: '28.12.2026',
			[fieldIds.orderNo]: '7-к',
			[fieldIds.salary]: '25 000',
			[fieldIds.probation]: '1 місяць',
			[fieldIds.contractNo]: '7'
		};
		const resolved = await resolveFields(steps, values);
		expect(resolved[fieldIds.orderDate]).toBe('29.12.2026'); // заява + 1 день
		expect(resolved[fieldIds.contractDate]).toBe('29.12.2026'); // = дата наказу

		const texts: string[] = [];
		for (const step of steps) {
			const doc = step.docs[0];
			const reps = await Promise.all(
				step.marks.map(async (m) => ({
					para: m.para,
					start: m.start,
					end: m.end,
					value: await applyTransform(resolved[m.fieldId], m.transform)
				}))
			);
			const out = await buildPreview(await fillDocx(data[doc.id], reps));
			texts.push(Object.values(out.text).join('\n'));
		}
		const [zayava, nakaz, dogovir] = texts;
		expect(zayava).toContain('Директору ТОВ «Веселка»');
		expect(zayava).toContain('Коваль Ірині Олегівні');
		expect(zayava).toContain('Шевчука Максима Сергійовича');
		expect(zayava).toContain('на посаду менеджера з продажу з 05.01.2027.');
		expect(zayava).toContain('Максим ШЕВЧУК');
		expect(nakaz).toContain('«ВЕСЕЛКА»');
		expect(nakaz).toContain('29.12.2026\t\t\t\tм. Львів\t\t\t\t№ 7-к');
		expect(nakaz).toContain('ШЕВЧУКА Максима Сергійовича на посаду менеджера з продажу');
		expect(nakaz).toContain('заява ШЕВЧУК М.С. від 28.12.2026.');
		expect(nakaz).toContain('Ірина КОВАЛЬ');
		expect(dogovir).toContain('ТРУДОВИЙ ДОГОВІР № 7');
		expect(dogovir).toContain('в особі директора Коваль Ірини Олегівни');
		for (const t of texts) expect(t).not.toMatch(/Петренк|Мельник|Світанок|СВІТАНОК|бухгалтер/);
	});
});
