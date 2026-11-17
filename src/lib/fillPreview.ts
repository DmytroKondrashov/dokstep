import type { DocPreview, PreviewBlock, PreviewParagraph, PreviewRun } from './types.ts';

export interface PreviewReplacement {
	id: string;
	para: string;
	start: number;
	end: number;
	/** The text that goes in; empty shows `[label]` as a placeholder. */
	value: string;
	label: string;
}

export interface FilledRange {
	id: string;
	start: number;
	end: number;
	kind: 'filled' | 'empty';
	title: string;
}

/**
 * The preview of a document as it will be generated: every mark replaced by its value,
 * keeping the formatting of the first replaced character (like the .docx filler).
 * Returns the new preview and, per paragraph, where the values ended up.
 */
export function fillPreview(
	pv: DocPreview,
	reps: PreviewReplacement[]
): { preview: DocPreview; ranges: Record<string, FilledRange[]> } {
	const byPara = new Map<string, PreviewReplacement[]>();
	for (const r of reps) {
		if (!byPara.has(r.para)) byPara.set(r.para, []);
		byPara.get(r.para)!.push(r);
	}
	const ranges: Record<string, FilledRange[]> = {};
	const text: Record<string, string> = { ...pv.text };

	const para = (p: PreviewParagraph): PreviewParagraph => {
		const rs = byPara.get(p.key);
		if (!rs) return p;
		const { runs, out } = replaceRuns(p.runs, rs);
		ranges[p.key] = out;
		text[p.key] = runs.map((r) => r.text).join('');
		return { ...p, runs };
	};
	const block = (b: PreviewBlock): PreviewBlock =>
		b.t === 'p'
			? para(b)
			: {
					...b,
					rows: b.rows.map((row) => row.map((c) => ({ ...c, blocks: c.blocks.map(block) })))
				};

	const preview: DocPreview = {
		...pv,
		text,
		parts: pv.parts.map((part) => ({ ...part, blocks: part.blocks.map(block) }))
	};
	return { preview, ranges };
}

function replaceRuns(runs: PreviewRun[], reps: PreviewReplacement[]) {
	const sorted = [...reps].sort((a, b) => a.start - b.start);
	const cuts = new Set(sorted.flatMap((r) => [r.start, r.end]));
	const result: PreviewRun[] = [];
	const out: FilledRange[] = [];
	let orig = 0;
	let pos = 0;
	for (const run of runs) {
		let i = 0;
		while (i < run.text.length) {
			let j = i + 1;
			while (j < run.text.length && !cuts.has(orig + j)) j++;
			const at = orig + i;
			const rep = sorted.find((r) => r.start <= at && at < r.end);
			if (!rep) {
				result.push({ ...run, text: run.text.slice(i, j) });
				pos += j - i;
			} else if (at === rep.start) {
				const t = rep.value || `[${rep.label}]`;
				const { highlight: _h, ...fmt } = run;
				result.push({ ...fmt, text: t });
				out.push({
					id: rep.id,
					start: pos,
					end: pos + t.length,
					kind: rep.value ? 'filled' : 'empty',
					title: rep.label
				});
				pos += t.length;
			}
			i = j;
		}
		orig += run.text.length;
	}
	return { runs: result, out };
}
