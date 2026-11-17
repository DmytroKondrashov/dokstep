import { fail, redirect } from '@sveltejs/kit';
import {
	createRun,
	createWorkflow,
	deleteRun,
	deleteWorkflow,
	getWorkflow,
	listRuns,
	listWorkflows
} from '#lib/server/db.js';
import { createDemoWorkflow } from '#lib/server/demo.js';
import type { Step, Workflow } from '#lib/types.js';
import type { Actions, PageServerLoad } from './$types';

/** Thumbnail lines for a step: its marks in reading order, own (yellow) vs inherited (green). */
function bars(step: Step): ('own' | 'inh' | 'plain')[] {
	const own = new Set(step.fields.map((f) => f.id));
	const marks = [...step.marks].sort(
		(a, b) => a.para.localeCompare(b.para, undefined, { numeric: true }) || a.start - b.start
	);
	const out: ('own' | 'inh' | 'plain')[] = [];
	for (const m of marks.slice(0, 4)) out.push(own.has(m.fieldId) ? 'own' : 'inh', 'plain');
	return out.length ? out : ['plain', 'plain', 'plain'];
}

/** A step is complete when each of its fields is typed or filled automatically. */
function stepsDone(wf: Workflow, values: Record<string, string>) {
	return wf.steps.filter((s) => s.fields.every((f) => values[f.id]?.trim() || f.defaultFrom))
		.length;
}

export const load: PageServerLoad = () => {
	const runs = listRuns();
	const workflows = listWorkflows().map((summary) => {
		const wf = getWorkflow(summary.id)!;
		return {
			...summary,
			fields: wf.steps.reduce((n, s) => n + s.fields.length, 0),
			runs: runs.filter((r) => r.workflowId === wf.id).length,
			steps: wf.steps.map((s) => ({ name: s.name, bars: bars(s) }))
		};
	});
	const byId = new Map(listWorkflows().map((w) => [w.id, getWorkflow(w.id)!]));
	return {
		workflows,
		runs: runs.slice(0, 12).map((r) => {
			const wf = byId.get(r.workflowId)!;
			return { ...r, stepsTotal: wf.steps.length, stepsDone: stepsDone(wf, r.values) };
		})
	};
};

export const actions: Actions = {
	createWorkflow: async ({ request }) => {
		const name = String((await request.formData()).get('name') ?? '').trim();
		if (!name) return fail(400, { error: 'Вкажіть назву процесу' });
		redirect(303, `/workflows/${createWorkflow(name).id}`);
	},
	createDemo: async () => {
		redirect(303, `/workflows/${await createDemoWorkflow()}`);
	},
	deleteWorkflow: async ({ request }) => {
		deleteWorkflow(String((await request.formData()).get('id')));
	},
	createRun: async ({ request }) => {
		const form = await request.formData();
		const wf = getWorkflow(String(form.get('workflowId')));
		if (!wf) return fail(404, { error: 'Процес не знайдено' });
		const name =
			String(form.get('name') ?? '').trim() ||
			`${wf.name} — ${new Date().toLocaleDateString('uk-UA')}`;
		redirect(303, `/runs/${createRun(wf.id, name).id}`);
	},
	deleteRun: async ({ request }) => {
		deleteRun(String((await request.formData()).get('id')));
	}
};
