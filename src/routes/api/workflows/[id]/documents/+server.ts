import { error, json } from '@sveltejs/kit';
import { addDocument, getWorkflow } from '#lib/server/db.js';
import { FORMATS, documentPreview, formatOf } from '#lib/server/documents.js';
import type { DocPreview } from '#lib/types.js';
import type { RequestHandler } from './$types';

/** POST multipart `files` (.docx, .txt) → [{ id, name, format, preview }]. The editor adds them to a step. */
export const POST: RequestHandler = async ({ params, request }) => {
	if (!getWorkflow(params.id)) error(404, 'Процес не знайдено');
	const files = (await request.formData())
		.getAll('files')
		.filter((f): f is File => f instanceof File);
	if (!files.length) error(400, 'Немає файлів');
	const out = [];
	for (const file of files) {
		const format = formatOf(file.name);
		if (!format) error(400, `«${file.name}»: підтримуються лише файли .docx і .txt`);
		const data = new Uint8Array(await file.arrayBuffer());
		let preview: DocPreview;
		try {
			preview = await documentPreview(format, data);
		} catch (e) {
			console.error('Preview failed:', e);
			error(400, `«${file.name}»: не вдалося прочитати документ`);
		}
		const id = addDocument(params.id, file.name, data, preview);
		const name = file.name.slice(0, -FORMATS[format].ext.length);
		out.push({ id, name, format, preview });
	}
	return json(out);
};
