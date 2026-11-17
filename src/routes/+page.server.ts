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
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({ workflows: listWorkflows(), runs: listRuns() });

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
