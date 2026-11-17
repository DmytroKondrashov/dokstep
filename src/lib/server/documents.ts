import type { DocFormat, DocPreview } from '#lib/types.js';
import { fillDocx, type Replacement } from './docx/fill.ts';
import { buildPreview } from './docx/preview.ts';
import { fillText, textPreview } from './text.ts';

/** Supported example-document formats, by file extension. */
export const FORMATS: Record<DocFormat, { ext: string; mime: string }> = {
	docx: {
		ext: '.docx',
		mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
	},
	txt: { ext: '.txt', mime: 'text/plain; charset=utf-8' }
};

/** Format of an uploaded file, or null when unsupported. */
export function formatOf(filename: string): DocFormat | null {
	const lower = filename.toLowerCase();
	for (const [f, { ext }] of Object.entries(FORMATS))
		if (lower.endsWith(ext)) return f as DocFormat;
	return null;
}

export async function documentPreview(format: DocFormat, data: Uint8Array): Promise<DocPreview> {
	return format === 'txt' ? textPreview(data) : buildPreview(data);
}

export async function fillDocument(
	format: DocFormat,
	data: Uint8Array,
	replacements: Replacement[]
): Promise<Uint8Array> {
	return format === 'txt' ? fillText(data, replacements) : fillDocx(data, replacements);
}
