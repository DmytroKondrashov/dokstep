import { error } from '@sveltejs/kit';
import { getDocumentData } from '#lib/server/db.js';
import { docxResponse } from '#lib/server/http.js';
import type { RequestHandler } from './$types';

/** GET the original uploaded example. */
export const GET: RequestHandler = ({ params }) => {
	const doc = getDocumentData(params.docId);
	if (!doc) error(404, 'Документ не знайдено');
	return docxResponse(doc.data, doc.name);
};
