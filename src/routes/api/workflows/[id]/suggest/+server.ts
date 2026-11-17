import { error, json } from '@sveltejs/kit';
import { getPreviews, getWorkflow } from '#lib/server/db.js';
import { suggestMarks } from '#lib/server/engine.js';
import type { Step } from '#lib/types.js';
import type { RequestHandler } from './$types';

/** POST { steps, stepId } → suggestions for that step (uses the editor's unsaved steps). */
export const POST: RequestHandler = async ({ params, request }) => {
	if (!getWorkflow(params.id)) error(404, 'Процес не знайдено');
	const { steps, stepId } = (await request.json()) as { steps: Step[]; stepId: string };
	return json(await suggestMarks(steps, stepId, getPreviews(params.id)));
};
