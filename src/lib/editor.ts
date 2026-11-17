import type { DocPreview, Field, Mark, Step, Transform } from './types.ts';

export const uid = () => crypto.randomUUID().replaceAll('-', '').slice(0, 16);

export interface TextRange {
	docId: string;
	para: string;
	start: number;
	end: number;
}

const isWordChar = (ch: string | undefined) => !!ch && /[\p{L}\p{N}]/u.test(ch);

export function overlapsMark(marks: Mark[], r: TextRange): Mark | undefined {
	return marks.find(
		(m) => m.docId === r.docId && m.para === r.para && r.start < m.end && m.start < r.end
	);
}

/** Whole-word, unmarked occurrences of `text` in the step's documents. */
export function findOccurrences(
	step: Step,
	previews: Record<string, DocPreview>,
	text: string
): TextRange[] {
	const out: TextRange[] = [];
	if (!text.trim()) return out;
	for (const doc of step.docs) {
		const pv = previews[doc.id];
		if (!pv) continue;
		for (const [para, t] of Object.entries(pv.text)) {
			for (let i = t.indexOf(text); i !== -1; i = t.indexOf(text, i + text.length)) {
				const r = { docId: doc.id, para, start: i, end: i + text.length };
				if (isWordChar(t[i - 1]) || isWordChar(t[r.end])) continue;
				if (!overlapsMark(step.marks, r) && !overlapsMark(out as Mark[], r)) out.push(r);
			}
		}
	}
	return out;
}

export function addMarks(step: Step, ranges: TextRange[], fieldId: string, transform?: Transform) {
	for (const r of ranges) {
		if (overlapsMark(step.marks, r)) continue;
		step.marks.push({ id: uid(), ...r, fieldId, ...(transform ? { transform } : {}) });
	}
}

/** Remove a field everywhere: its marks (in any step) and defaults that point at it. */
export function removeField(steps: Step[], fieldId: string) {
	for (const s of steps) {
		s.fields = s.fields.filter((f) => f.id !== fieldId);
		s.marks = s.marks.filter((m) => m.fieldId !== fieldId);
		for (const f of s.fields) if (f.defaultFrom?.fieldId === fieldId) f.defaultFrom = null;
	}
}

export function removeStep(steps: Step[], index: number) {
	for (const f of [...steps[index].fields]) removeField(steps, f.id);
	steps.splice(index, 1);
}

export function removeDoc(step: Step, docId: string) {
	step.docs = step.docs.filter((d) => d.id !== docId);
	step.marks = step.marks.filter((m) => m.docId !== docId);
}

export interface FieldOption {
	field: Field;
	stepIndex: number;
	stepName: string;
}

/** Fields a mark in step `index` may use: the step's own, then earlier steps' (nearest first). */
export function availableFields(steps: Step[], index: number): FieldOption[] {
	const out: FieldOption[] = [];
	for (let i = index; i >= 0; i--)
		for (const field of steps[i].fields) out.push({ field, stepIndex: i, stepName: steps[i].name });
	return out;
}

export function fieldLocation(
	steps: Step[],
	fieldId: string
): { field: Field; stepIndex: number } | null {
	for (const [stepIndex, s] of steps.entries()) {
		const field = s.fields.find((f) => f.id === fieldId);
		if (field) return { field, stepIndex };
	}
	return null;
}

/** Fields of earlier steps that this step's marks use, with how many places. */
export function inheritedFields(steps: Step[], index: number): (FieldOption & { count: number })[] {
	const own = new Set(steps[index].fields.map((f) => f.id));
	const counts = new Map<string, number>();
	for (const m of steps[index].marks)
		if (!own.has(m.fieldId)) counts.set(m.fieldId, (counts.get(m.fieldId) ?? 0) + 1);
	const out: (FieldOption & { count: number })[] = [];
	for (const [id, count] of counts) {
		const loc = fieldLocation(steps, id);
		if (loc)
			out.push({
				field: loc.field,
				stepIndex: loc.stepIndex,
				stepName: steps[loc.stepIndex].name,
				count
			});
	}
	return out.sort((a, b) => a.stepIndex - b.stepIndex);
}

/** A short label for a new field from the selected text. */
export function suggestLabel(text: string): string {
	const t = text.replace(/\s+/g, ' ').trim();
	return t.length > 40 ? `${t.slice(0, 37)}…` : t;
}
