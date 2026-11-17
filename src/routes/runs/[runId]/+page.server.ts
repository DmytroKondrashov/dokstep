import { error } from '@sveltejs/kit';
import { getPreviews, getRun, getWorkflow } from '#lib/server/db.js';
import { resolveFields, resolveMarks } from '#lib/server/engine.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const run = getRun(params.runId);
	if (!run) error(404, 'Справу не знайдено');
	const workflow = getWorkflow(run.workflowId);
	if (!workflow) error(404, 'Процес не знайдено');
	const resolved = await resolveFields(workflow.steps, run.values);
	return {
		run,
		workflow,
		resolved,
		markValues: await resolveMarks(workflow.steps, resolved),
		previews: getPreviews(workflow.id)
	};
};
