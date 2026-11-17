import { error, json } from '@sveltejs/kit';
import { getRun, getWorkflow, saveRun } from '#lib/server/db.js';
import { resolveFields } from '#lib/server/engine.js';
import type { RequestHandler } from './$types';

/** PUT { name, values } → saves and returns every field's resolved value. */
export const PUT: RequestHandler = async ({ params, request }) => {
	const run = getRun(params.runId);
	if (!run) error(404, 'Справу не знайдено');
	const workflow = getWorkflow(run.workflowId)!;
	const { name, values } = (await request.json()) as {
		name: string;
		values: Record<string, string>;
	};
	saveRun(run.id, name?.trim() || run.name, values ?? {});
	return json({ resolved: await resolveFields(workflow.steps, values ?? {}) });
};
