import type { Transform } from './types.ts';

/* Small browser-side helpers around the JSON endpoints. */

export async function api<T>(url: string, method: string, body?: unknown): Promise<T> {
	const res = await fetch(url, {
		method,
		headers: body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
		body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body)
	});
	if (!res.ok) {
		const msg = await res
			.json()
			.then((j) => j.message)
			.catch(() => res.statusText);
		throw new Error(msg || `HTTP ${res.status}`);
	}
	return res.json() as Promise<T>;
}

const cache = new Map<string, Promise<string>>();

/** Server-side transform (declension needs the server), cached per value+transform. */
export function previewTransform(value: string, transform: Transform | undefined): Promise<string> {
	const key = `${value}\u0000${JSON.stringify(transform ?? {})}`;
	let p = cache.get(key);
	if (!p) {
		p = api<string[]>('/api/transform', 'POST', { items: [{ value, transform }] }).then(
			(r) => r[0]
		);
		p.catch(() => cache.delete(key));
		cache.set(key, p);
	}
	return p;
}

/** Call `fn` once things have been quiet for `ms`; `flush()` runs a pending call now. */
export function debounce<A extends unknown[]>(fn: (...args: A) => unknown, ms: number) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let lastArgs: A | undefined;
	const run = () => {
		timer = undefined;
		if (lastArgs) {
			const a = lastArgs;
			lastArgs = undefined;
			return fn(...a);
		}
	};
	const call = (...args: A) => {
		lastArgs = args;
		clearTimeout(timer);
		timer = setTimeout(run, ms);
	};
	call.flush = () => {
		clearTimeout(timer);
		return run();
	};
	call.pending = () => timer !== undefined;
	return call;
}
