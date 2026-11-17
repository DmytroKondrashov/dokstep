import { error, json } from '@sveltejs/kit';
import { addDocument, getWorkflow } from '#lib/server/db.js';
import { buildPreview } from '#lib/server/docx/preview.js';
import type { DocPreview } from '#lib/types.js';
import type { RequestHandler } from './$types';

/** POST multipart `files` (.docx) → [{ id, name, preview }]. The editor adds them to a step. */
export const POST: RequestHandler = async ({ params, request }) => {
	if (!getWorkflow(params.id)) error(404, 'Процес не знайдено');
	const files = (await request.formData())
		.getAll('files')
		.filter((f): f is File => f instanceof File);
	if (!files.length) error(400, 'Немає файлів');
	const out = [];
	for (const file of files) {
		if (!file.name.toLowerCase().endsWith('.docx'))
			error(400, `«${file.name}»: підтримуються лише файли .docx`);
		const data = new Uint8Array(await file.arrayBuffer());
		let preview: DocPreview;
		try {
			preview = await buildPreview(data);
		} catch (e) {
			console.error('Preview failed:', e);
			error(400, `«${file.name}»: не вдалося прочитати документ`);
		}
		const id = addDocument(params.id, file.name, data, preview);
		out.push({ id, name: file.name.replace(/\.docx$/i, ''), preview });
	}
	return json(out);
};
