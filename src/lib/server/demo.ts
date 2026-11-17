import JSZip from 'jszip';
import { addMarks, findOccurrences } from '#lib/editor.js';
import type { DocPreview, Field, Step, Transform } from '#lib/types.js';
import { addDocument, createWorkflow, newId, saveWorkflow } from './db.ts';
import { buildPreview } from './docx/preview.ts';

/**
 * Demo workflow «Прийняття на роботу» (application → hiring order → employment contract).
 * The example documents are generated here, highlighted like real examples:
 * yellow = typed on this step, green = taken from an earlier step.
 */

type Seg = string | { t: string; hl: 'yellow' | 'green' };
interface Para {
	segs: Seg[];
	align?: 'center' | 'right' | 'both';
	b?: boolean;
	/** Left indent in cm (address block of an application). */
	indent?: number;
	firstLine?: boolean;
}

const y = (t: string): Seg => ({ t, hl: 'yellow' });
const g = (t: string): Seg => ({ t, hl: 'green' });
const p = (segs: Seg[], opts: Omit<Para, 'segs'> = {}): Para => ({ segs, ...opts });
const blank = (): Para => ({ segs: [] });

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function runXml(text: string, b: boolean, hl?: string) {
	const rPr =
		'<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>' +
		(b ? '<w:b/>' : '') +
		(hl ? `<w:highlight w:val="${hl}"/>` : '') +
		'<w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr>';
	const body = text
		.split('\t')
		.map((chunk) => (chunk ? `<w:t xml:space="preserve">${esc(chunk)}</w:t>` : ''))
		.join('<w:tab/>');
	return `<w:r>${rPr}${body}</w:r>`;
}

function paraXml(para: Para) {
	const pPr =
		'<w:pPr><w:spacing w:after="0" w:line="276" w:lineRule="auto"/>' +
		(para.indent || para.firstLine
			? `<w:ind${para.indent ? ` w:left="${Math.round(para.indent * 567)}"` : ''}${para.firstLine ? ' w:firstLine="709"' : ''}/>`
			: '') +
		(para.align ? `<w:jc w:val="${para.align}"/>` : '') +
		'</w:pPr>';
	const runs = para.segs
		.map((s) => (typeof s === 'string' ? runXml(s, !!para.b) : runXml(s.t, !!para.b, s.hl)))
		.join('');
	return `<w:p>${pPr}${runs}</w:p>`;
}

async function makeDocx(paras: Para[]): Promise<Uint8Array> {
	const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
	const zip = new JSZip();
	zip.file(
		'[Content_Types].xml',
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
	);
	zip.file(
		'_rels/.rels',
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
	);
	// A4, margins 3 / 1.5 / 2 / 2 cm (ДСТУ 4163)
	const sect =
		'<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="851" w:bottom="1134" w:left="1701" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr>';
	zip.file(
		'word/document.xml',
		`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>${paras.map(paraXml).join('')}${sect}</w:body></w:document>`
	);
	return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

/* ---------- content ---------- */

interface FieldSpec {
	key: string;
	label: string;
	example: string;
	multiline?: boolean;
	defaultFrom?: { key: string; transform?: Transform };
}
interface MarkSpec {
	text: string;
	key: string;
	transform?: Transform;
}
interface StepSpec {
	name: string;
	doc: { name: string; outputName: string; paras: Para[] };
	fields: FieldSpec[];
	marks: MarkSpec[];
}

const STEPS: StepSpec[] = [
	{
		name: 'Заява про прийняття на роботу',
		doc: {
			name: 'Заява Петренко',
			outputName: 'Заява про прийняття на роботу {ПІБ працівника}',
			paras: [
				p(['Директору ТОВ «', y('Світанок'), '»'], { indent: 9 }),
				p([y('Мельнику Андрію Петровичу')], { indent: 9 }),
				p([y('Петренко Олени Іванівни')], { indent: 9 }),
				p(['адреса: ', y('м. Львів, вул. Зелена, 12, кв. 5')], { indent: 9 }),
				blank(),
				p(['ЗАЯВА'], { align: 'center', b: true }),
				blank(),
				p(['Прошу прийняти мене на посаду ', y('бухгалтера'), ' з ', y('01.12.2026'), '.'], {
					align: 'both',
					firstLine: true
				}),
				blank(),
				p([y('20.11.2026'), '\t\t\t\t\t\t\t', y('Олена ПЕТРЕНКО')])
			]
		},
		fields: [
			{ key: 'company', label: 'Назва підприємства', example: 'Світанок' },
			{ key: 'director', label: 'Директор (ПІБ)', example: 'Мельник Андрій Петрович' },
			{ key: 'employee', label: 'ПІБ працівника', example: 'Петренко Олена Іванівна' },
			{ key: 'address', label: 'Адреса працівника', example: 'м. Львів, вул. Зелена, 12, кв. 5' },
			{ key: 'position', label: 'Посада', example: 'бухгалтер' },
			{ key: 'start', label: 'Дата початку роботи', example: '01.12.2026' },
			{ key: 'appDate', label: 'Дата заяви', example: '20.11.2026' }
		],
		marks: [
			{ text: 'Світанок', key: 'company' },
			{ text: 'Мельнику Андрію Петровичу', key: 'director', transform: { case: 'dat' } },
			{ text: 'Петренко Олени Іванівни', key: 'employee', transform: { case: 'gen' } },
			{ text: 'Олена ПЕТРЕНКО', key: 'employee', transform: { nameFormat: 'givenSurname' } },
			{ text: 'м. Львів, вул. Зелена, 12, кв. 5', key: 'address' },
			{ text: 'бухгалтера', key: 'position', transform: { case: 'gen', declineAs: 'appointment' } },
			{ text: '01.12.2026', key: 'start' },
			{ text: '20.11.2026', key: 'appDate' }
		]
	},
	{
		name: 'Наказ про прийняття на роботу',
		doc: {
			name: 'Наказ 45-к',
			outputName: 'Наказ {Номер наказу} про прийняття {ПІБ працівника}',
			paras: [
				p(['ТОВАРИСТВО З ОБМЕЖЕНОЮ ВІДПОВІДАЛЬНІСТЮ «', g('СВІТАНОК'), '»'], {
					align: 'center',
					b: true
				}),
				blank(),
				p(['НАКАЗ'], { align: 'center', b: true }),
				blank(),
				p([y('21.11.2026'), '\t\t\t\tм. Львів\t\t\t\t№ ', y('45-к')]),
				blank(),
				p(['Про прийняття на роботу'], { b: true }),
				blank(),
				p(['ПРИЙНЯТИ:']),
				p(
					[
						g('ПЕТРЕНКО Олену Іванівну'),
						' на посаду ',
						g('бухгалтера'),
						' з ',
						g('01.12.2026'),
						' з посадовим окладом ',
						y('18 000'),
						' грн на місяць та випробувальним терміном ',
						y('3 місяці'),
						'.'
					],
					{ align: 'both', firstLine: true }
				),
				p(['Підстава: заява ', g('ПЕТРЕНКО О.І.'), ' від ', g('20.11.2026'), '.'], {
					firstLine: true
				}),
				blank(),
				p(['Директор\t\t\t\t\t\t\t', g('Андрій МЕЛЬНИК')]),
				blank(),
				p(['З наказом ознайомлений(-а)\t\t\t\t\t', g('Олена ПЕТРЕНКО')])
			]
		},
		fields: [
			{
				key: 'orderDate',
				label: 'Дата наказу',
				example: '21.11.2026',
				defaultFrom: { key: 'appDate', transform: { addDays: 1 } }
			},
			{ key: 'orderNo', label: 'Номер наказу', example: '45-к' },
			{ key: 'salary', label: 'Посадовий оклад, грн', example: '18 000' },
			{ key: 'probation', label: 'Випробувальний термін', example: '3 місяці' }
		],
		marks: [
			{ text: 'СВІТАНОК', key: 'company', transform: { letter: 'upper' } },
			{
				text: 'ПЕТРЕНКО Олену Іванівну',
				key: 'employee',
				transform: { case: 'acc', nameFormat: 'surnameFull' }
			},
			{ text: 'ПЕТРЕНКО О.І.', key: 'employee', transform: { nameFormat: 'surnameInitials' } },
			{ text: 'Андрій МЕЛЬНИК', key: 'director', transform: { nameFormat: 'givenSurname' } },
			{ text: 'Олена ПЕТРЕНКО', key: 'employee', transform: { nameFormat: 'givenSurname' } },
			{ text: 'бухгалтера', key: 'position', transform: { case: 'gen', declineAs: 'appointment' } },
			{ text: '01.12.2026', key: 'start' },
			{ text: '20.11.2026', key: 'appDate' },
			{ text: '21.11.2026', key: 'orderDate' },
			{ text: '45-к', key: 'orderNo' },
			{ text: '18 000', key: 'salary' },
			{ text: '3 місяці', key: 'probation' }
		]
	},
	{
		name: 'Трудовий договір',
		doc: {
			name: 'Трудовий договір 45',
			outputName: 'Трудовий договір № {Номер договору} {ПІБ працівника}',
			paras: [
				p(['ТРУДОВИЙ ДОГОВІР № ', y('45')], { align: 'center', b: true }),
				blank(),
				p(['м. Львів\t\t\t\t\t\t\t\t', y('21.11.2026')]),
				blank(),
				p(
					[
						'ТОВ «',
						g('Світанок'),
						'» в особі директора ',
						g('Мельника Андрія Петровича'),
						', що діє на підставі Статуту (далі — Роботодавець), та ',
						g('Петренко Олена Іванівна'),
						' (далі — Працівник) уклали цей договір про таке:'
					],
					{ align: 'both', firstLine: true }
				),
				p(['1. Працівник приймається на посаду ', g('бухгалтера'), ' з ', g('01.12.2026'), '.'], {
					firstLine: true
				}),
				p(['2. Посадовий оклад становить ', g('18 000'), ' грн на місяць.'], { firstLine: true }),
				p(['3. Випробувальний термін — ', g('3 місяці'), '.'], { firstLine: true }),
				p(['4. Договір укладено на невизначений строк.'], { firstLine: true }),
				blank(),
				p(['Роботодавець: ТОВ «', g('Світанок'), '»']),
				p(['Директор ____________ ', g('Андрій МЕЛЬНИК')]),
				blank(),
				p(['Працівник: ', g('Петренко Олена Іванівна')]),
				p(['Адреса: ', g('м. Львів, вул. Зелена, 12, кв. 5')]),
				p(['____________ ', g('Олена ПЕТРЕНКО')])
			]
		},
		fields: [
			{ key: 'contractNo', label: 'Номер договору', example: '45' },
			{
				key: 'contractDate',
				label: 'Дата договору',
				example: '21.11.2026',
				defaultFrom: { key: 'orderDate' }
			}
		],
		marks: [
			{ text: 'Світанок', key: 'company' },
			{ text: 'Мельника Андрія Петровича', key: 'director', transform: { case: 'gen' } },
			{ text: 'Петренко Олена Іванівна', key: 'employee' },
			{ text: 'Андрій МЕЛЬНИК', key: 'director', transform: { nameFormat: 'givenSurname' } },
			{ text: 'Олена ПЕТРЕНКО', key: 'employee', transform: { nameFormat: 'givenSurname' } },
			{ text: 'м. Львів, вул. Зелена, 12, кв. 5', key: 'address' },
			{ text: 'бухгалтера', key: 'position', transform: { case: 'gen', declineAs: 'appointment' } },
			{ text: '01.12.2026', key: 'start' },
			{ text: '18 000', key: 'salary' },
			{ text: '3 місяці', key: 'probation' },
			{ text: '21.11.2026', key: 'contractDate' },
			{ text: '45', key: 'contractNo' }
		]
	}
];

export const DEMO_NAME = 'Прийняття на роботу (приклад)';

export interface DemoDoc {
	stepIndex: number;
	name: string;
	data: Uint8Array;
	preview: DocPreview;
}

/** Build the demo's documents and steps; `docId` names each document (DB id or a test id). */
export async function buildDemo(docId: (d: DemoDoc) => string) {
	const ids = new Map<string, string>();
	const fieldId = (key: string) => {
		if (!ids.has(key)) ids.set(key, newId());
		return ids.get(key)!;
	};
	const steps: Step[] = [];
	const previews: Record<string, DocPreview> = {};
	for (const [stepIndex, spec] of STEPS.entries()) {
		const data = await makeDocx(spec.doc.paras);
		const preview = await buildPreview(data);
		const id = docId({ stepIndex, name: spec.doc.name, data, preview });
		previews[id] = preview;
		const step: Step = {
			id: newId(),
			name: spec.name,
			docs: [{ id, name: spec.doc.name, outputName: spec.doc.outputName }],
			fields: spec.fields.map(
				(f): Field => ({
					id: fieldId(f.key),
					label: f.label,
					example: f.example,
					...(f.multiline ? { multiline: true } : {}),
					defaultFrom: f.defaultFrom
						? { fieldId: fieldId(f.defaultFrom.key), transform: f.defaultFrom.transform }
						: null
				})
			),
			marks: []
		};
		for (const m of spec.marks) {
			const ranges = findOccurrences(step, previews, m.text);
			if (!ranges.length) throw new Error(`Demo: «${m.text}» not found in «${spec.doc.name}»`);
			addMarks(step, ranges, fieldId(m.key), m.transform);
		}
		steps.push(step);
	}
	return { steps, previews, fieldIds: Object.fromEntries(ids) };
}

/** Create the demo workflow in the database; returns its id. */
export async function createDemoWorkflow(): Promise<string> {
	const wf = createWorkflow(
		DEMO_NAME,
		'Приклад: заява → наказ → трудовий договір. Жовте вводиться, зелене береться з попередніх кроків.',
		{ steps: [] }
	);
	const { steps } = await buildDemo((d) => addDocument(wf.id, `${d.name}.docx`, d.data, d.preview));
	saveWorkflow(wf.id, { name: wf.name, description: wf.description, steps });
	return wf.id;
}
