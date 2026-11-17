import { error } from '@sveltejs/kit';
import { getRun, getWorkflow } from '#lib/server/db.js';
import { resolveFields } from '#lib/server/engine.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const run = getRun(params.runId);
	if (!run) error(404, 'Справу не знайдено');
	const workflow = getWorkflow(run.workflowId);
	if (!workflow) error(404, 'Процес не знайдено');
	return { run, workflow, resolved: await resolveFields(workflow.steps, run.values) };
};
