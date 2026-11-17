import { json } from '@sveltejs/kit';
import { applyTransform } from '#lib/server/transform.js';
import type { Transform } from '#lib/types.js';
import type { RequestHandler } from './$types';

/** POST { items: [{ value, transform }] } → string[] (previews in the editor). */
export const POST: RequestHandler = async ({ request }) => {
	const { items } = (await request.json()) as { items: { value: string; transform?: Transform }[] };
	return json(
		await Promise.all((items ?? []).map((i) => applyTransform(i.value ?? '', i.transform)))
	);
};
