import { error } from '@sveltejs/kit';
import { getPreviews, getWorkflow, listRuns } from '#lib/server/db.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const workflow = getWorkflow(params.id);
	if (!workflow) error(404, 'Процес не знайдено');
	return { workflow, previews: getPreviews(params.id), runs: listRuns(params.id) };
};
