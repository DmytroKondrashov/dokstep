import { error, json } from '@sveltejs/kit';
import { getWorkflow, saveWorkflow } from '#lib/server/db.js';
import type { Workflow } from '#lib/types.js';
import type { RequestHandler } from './$types';

/** PUT { name, description, steps } — the editor autosaves the whole definition. */
export const PUT: RequestHandler = async ({ params, request }) => {
	if (!getWorkflow(params.id)) error(404, 'Процес не знайдено');
	const body = (await request.json()) as Pick<Workflow, 'name' | 'description' | 'steps'>;
	if (!body || !Array.isArray(body.steps)) error(400, 'Невірні дані');
	saveWorkflow(params.id, body);
	return json({ ok: true });
};
