import JSZip from 'jszip';
import {
	CASES,
	DATE_FORMATS,
	NAME_FORMATS,
	cleanTransform,
	fillPattern,
	parseDate,
	parseName
} from '#lib/transform.js';
import type {
	DocPreview,
	Field,
	Mark,
	Step,
	StepDoc,
	Suggestion,
	Transform,
	Workflow
} from '#lib/types.js';
import { getDocumentData } from './db.ts';
import { FORMATS, fillDocument } from './documents.ts';
import { applyTransform } from './transform.ts';

export const allFields = (steps: Step[]) => steps.flatMap((s) => s.fields);

/**
 * Value of every field for a run: what the user typed, else the `defaultFrom` source
 * (transformed), else ''. Evaluated lazily, so step order does not matter; cycles give ''.
 */
export async function resolveFields(
	steps: Step[],
	values: Record<string, string>
): Promise<Record<string, string>> {
	const byId = new Map<string, Field>(allFields(steps).map((f) => [f.id, f]));
	const memo = new Map<string, Promise<string>>();
	const visiting = new Set<string>();

	const value = (id: string): Promise<string> => {
		const m = memo.get(id);
		if (m) return m;
		if (visiting.has(id)) return Promise.resolve('');
		visiting.add(id);
		const f = byId.get(id);
		const typed = values[id];
		let p: Promise<string>;
		if (!f) p = Promise.resolve('');
		else if (typed?.trim()) p = Promise.resolve(typed);
		else if (f.defaultFrom)
			p = value(f.defaultFrom.fieldId).then((v) => applyTransform(v, f.defaultFrom!.transform));
		else p = Promise.resolve('');
		memo.set(id, p);
		return p;
	};

	const out: Record<string, string> = {};
	for (const id of byId.keys()) out[id] = await value(id);
	return out;
}

const markValue = (m: Mark, fieldValues: Record<string, string>) =>
	applyTransform(fieldValues[m.fieldId] ?? '', m.transform);

/** The text every mark becomes (its field's value, transformed), by mark id. */
export async function resolveMarks(
	steps: Step[],
	fieldValues: Record<string, string>
): Promise<Record<string, string>> {
	const marks = steps.flatMap((s) => s.marks);
	const values = await Promise.all(marks.map((m) => markValue(m, fieldValues)));
	return Object.fromEntries(marks.map((m, i) => [m.id, values[i]]));
}

function sanitizeFilename(s: string) {
	return s
		.replace(/[\\/:*?"<>|\n\r\t]+/g, '_')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 150);
}

export function outputFilename(doc: StepDoc, steps: Step[], fieldValues: Record<string, string>) {
	const byLabel = Object.fromEntries(
		allFields(steps).map((f) => [f.label.trim(), fieldValues[f.id] ?? ''])
	);
	const base = sanitizeFilename(fillPattern(doc.outputName || doc.name, byLabel)) || 'document';
	return `${base}${FORMATS[doc.format ?? 'docx'].ext}`;
}

export async function generateDoc(
	wf: Workflow,
	step: Step,
	doc: StepDoc,
	fieldValues: Record<string, string>
): Promise<{ filename: string; data: Uint8Array }> {
	const stored = getDocumentData(doc.id);
	if (!stored) throw new Error(`Document ${doc.id} not found`);
	const marks = step.marks.filter((m) => m.docId === doc.id);
	const replacements = await Promise.all(
		marks.map(async (m) => ({
			para: m.para,
			start: m.start,
			end: m.end,
			value: await markValue(m, fieldValues)
		}))
	);
	return {
		filename: outputFilename(doc, wf.steps, fieldValues),
		data: await fillDocument(doc.format ?? 'docx', stored.data, replacements)
	};
}

/** Several documents as one zip; with `folders`, one folder per step. */
export async function generateZip(
	wf: Workflow,
	steps: Step[],
	fieldValues: Record<string, string>,
	folders: boolean
): Promise<Uint8Array> {
	const zip = new JSZip();
	const used = new Set<string>();
	for (const step of steps) {
		const dir = folders
			? `${String(wf.steps.indexOf(step) + 1).padStart(2, '0')}. ${sanitizeFilename(step.name)}/`
			: '';
		for (const doc of step.docs) {
			const { filename, data } = await generateDoc(wf, step, doc, fieldValues);
			let path = dir + filename;
			for (let n = 2; used.has(path); n++)
				path = `${dir}${filename.replace(/(\.\w+)$/, ` (${n})$1`)}`;
			used.add(path);
			zip.file(path, data);
		}
	}
	return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

/* ---------- suggestions ---------- */

/** Text forms an example value can appear in: as is, declined, re-formatted, as a date. */
async function variants(example: string): Promise<{ text: string; transform?: Transform }[]> {
	const out: { text: string; transform?: Transform }[] = [{ text: example }];
	const add = async (t: Transform) => {
		const text = await applyTransform(example, t);
		if (text) out.push({ text, transform: cleanTransform(t) });
	};
	if (example !== example.toUpperCase()) await add({ letter: 'upper' });
	if (parseName(example)) {
		for (const c of CASES)
			for (const nf of NAME_FORMATS) {
				if (c.id === 'nom' && nf.id === 'full') continue;
				await add({ case: c.id, nameFormat: nf.id });
			}
	} else if (parseDate(example)) {
		for (const df of DATE_FORMATS) await add({ dateFormat: df.id });
	}
	// first transform that produces a given text wins
	return [...new Map(out.reverse().map((v) => [v.text, v])).values()].reverse();
}

const isWordChar = (ch: string | undefined) => !!ch && /[\p{L}\p{N}]/u.test(ch);

function meaningful(text: string) {
	const t = text.trim();
	return t.length >= 3 && !/^\d{1,3}$/.test(t);
}

/**
 * Unmarked places in `step`'s documents where a field's example value (of this or an
 * earlier step) occurs — as is or in a derived form — so they can be linked in one click.
 */
export async function suggestMarks(
	steps: Step[],
	stepId: string,
	previews: Record<string, DocPreview>
): Promise<Suggestion[]> {
	const idx = steps.findIndex((s) => s.id === stepId);
	if (idx < 0) return [];
	const step = steps[idx];
	// own fields first, then earlier steps from the nearest one back
	const candidates = [
		...step.fields,
		...steps
			.slice(0, idx)
			.reverse()
			.flatMap((s) => s.fields)
	].filter((f) => meaningful(f.example));

	const pending: { field: Field; text: string; transform?: Transform; order: number }[] = [];
	for (const [order, field] of candidates.entries())
		for (const v of await variants(field.example.trim()))
			if (meaningful(v.text)) pending.push({ field, ...v, order });
	// longer texts first, so «КОВАЛЕНКА Петра» wins over «КОВАЛЕНКА»
	pending.sort((a, b) => b.text.length - a.text.length || a.order - b.order);

	const taken = new Map<string, [number, number][]>();
	for (const m of step.marks) {
		const k = `${m.docId}|${m.para}`;
		if (!taken.has(k)) taken.set(k, []);
		taken.get(k)!.push([m.start, m.end]);
	}
	const overlaps = (k: string, s: number, e: number) =>
		(taken.get(k) ?? []).some(([a, b]) => s < b && a < e);

	const groups = new Map<string, Suggestion>();
	for (const c of pending) {
		for (const doc of step.docs) {
			const preview = previews[doc.id];
			if (!preview) continue;
			for (const [para, text] of Object.entries(preview.text)) {
				for (let i = text.indexOf(c.text); i !== -1; i = text.indexOf(c.text, i + 1)) {
					const end = i + c.text.length;
					if (isWordChar(text[i - 1]) || isWordChar(text[end])) continue;
					const k = `${doc.id}|${para}`;
					if (overlaps(k, i, end)) continue;
					if (!taken.has(k)) taken.set(k, []);
					taken.get(k)!.push([i, end]);
					const gk = `${c.field.id}|${JSON.stringify(c.transform ?? {})}`;
					if (!groups.has(gk))
						groups.set(gk, {
							fieldId: c.field.id,
							transform: c.transform,
							text: c.text,
							occurrences: []
						});
					groups.get(gk)!.occurrences.push({ docId: doc.id, para, start: i, end });
				}
			}
		}
	}
	return [...groups.values()];
}
