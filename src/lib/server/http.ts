function disposition(filename: string) {
	const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
	return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

const withExt = (name: string, ext: string) =>
	name.toLowerCase().endsWith(ext) ? name : `${name}${ext}`;

export function docxResponse(data: Uint8Array, filename: string) {
	return new Response(data as BodyInit, {
		headers: {
			'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
			'Content-Disposition': disposition(withExt(filename, '.docx'))
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
