import { FORMATS, formatOf } from './documents.ts';

function disposition(filename: string) {
	const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
	return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

const withExt = (name: string, ext: string) =>
	name.toLowerCase().endsWith(ext) ? name : `${name}${ext}`;

/** A generated or uploaded document as a download; the type comes from the file name. */
export function fileResponse(data: Uint8Array, filename: string) {
	const format = formatOf(filename) ?? 'docx';
	return new Response(data as BodyInit, {
		headers: {
			'Content-Type': FORMATS[format].mime,
			'Content-Disposition': disposition(withExt(filename, FORMATS[format].ext))
		}
	});
}

export function zipResponse(data: Uint8Array, filename: string) {
	return new Response(data as BodyInit, {
		headers: {
			'Content-Type': 'application/zip',
			'Content-Disposition': disposition(withExt(filename, '.zip'))
		}
	});
}
