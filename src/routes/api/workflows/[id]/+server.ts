import { error, json } from '@sveltejs/kit';
import { getWorkflow, saveWorkflow } from '#lib/server/db.js';
import type { Workflow } from '#lib/types.js';
import type { RequestHandler } from './$types';

/** PUT { name, description, steps, rev } — the editor autosaves the whole definition. */
export const PUT: RequestHandler = async ({ params, request }) => {
	if (!getWorkflow(params.id)) error(404, 'Процес не знайдено');
	const body = (await request.json()) as Pick<Workflow, 'name' | 'description' | 'steps'> & {
		rev?: number;
	};
	if (!body || !Array.isArray(body.steps)) error(400, 'Невірні дані');
	return json({ updatedAt: saveWorkflow(params.id, body, Number(body.rev) || 0) });
};
