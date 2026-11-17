import { error } from '@sveltejs/kit';
import { getRun, getWorkflow } from '#lib/server/db.js';
import { generateDoc, generateZip, resolveFields } from '#lib/server/engine.js';
import { fileResponse, zipResponse } from '#lib/server/http.js';
import type { RequestHandler } from './$types';

/**
 * GET ?step=<id>&doc=<id> → one document (.docx / .txt); ?step=<id> → the step's documents
 * (the file itself if there is one, else a .zip);
 * no query → every document of the workflow as a .zip with a folder per step.
 */
export const GET: RequestHandler = async ({ params, url }) => {
	const run = getRun(params.runId);
	if (!run) error(404, 'Справу не знайдено');
	const wf = getWorkflow(run.workflowId)!;
	const values = await resolveFields(wf.steps, run.values);

	const stepId = url.searchParams.get('step');
	if (!stepId) return zipResponse(await generateZip(wf, wf.steps, values, true), run.name);

	const step = wf.steps.find((s) => s.id === stepId);
	if (!step) error(404, 'Крок не знайдено');
	const docId = url.searchParams.get('doc');
	const docs = docId ? step.docs.filter((d) => d.id === docId) : step.docs;
	if (!docs.length) error(404, 'Документ не знайдено');
	if (docs.length === 1) {
		const { filename, data } = await generateDoc(wf, step, docs[0], values);
		return fileResponse(data, filename);
	}
	return zipResponse(await generateZip(wf, [step], values, false), `${run.name} — ${step.name}`);
};
