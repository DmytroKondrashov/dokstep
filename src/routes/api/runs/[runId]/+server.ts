import { error, json } from '@sveltejs/kit';
import { getRun, getWorkflow, saveRun } from '#lib/server/db.js';
import { resolveFields, resolveMarks } from '#lib/server/engine.js';
import type { RequestHandler } from './$types';

/** PUT { name, values, rev } → saves; returns `updatedAt`, every field's value and every mark's text. */
export const PUT: RequestHandler = async ({ params, request }) => {
	const run = getRun(params.runId);
	if (!run) error(404, 'Справу не знайдено');
	const workflow = getWorkflow(run.workflowId)!;
	const { name, values, rev } = (await request.json()) as {
		name: string;
		values: Record<string, string>;
		rev?: number;
	};
	const updatedAt = saveRun(run.id, name?.trim() || run.name, values ?? {}, Number(rev) || 0);
	const resolved = await resolveFields(workflow.steps, values ?? {});
	return json({ updatedAt, resolved, markValues: await resolveMarks(workflow.steps, resolved) });
};
