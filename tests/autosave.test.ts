// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Autosave } from '../src/lib/autosave.svelte.ts';

function memoryStorage() {
	const m = new Map<string, string>();
	return {
		getItem: (k: string) => m.get(k) ?? null,
		setItem: (k: string, v: string) => void m.set(k, v),
		removeItem: (k: string) => void m.delete(k),
		map: m
	};
}

type Call = { data: string; rev: number; resolve: (v: string) => void; reject: (e: Error) => void };

function setup(base = '2026-11-17T10:00:00.000Z') {
	const storage = memoryStorage();
	const calls: Call[] = [];
	const save = new Autosave<string>({
		key: 'k',
		base,
		delay: 100,
		storage,
		send: (data, o) =>
			new Promise((resolve, reject) => calls.push({ data, rev: o.rev, resolve, reject }))
	});
	return { storage, calls, save };
}

const draftOf = (s: ReturnType<typeof memoryStorage>) => JSON.parse(s.map.get('k') ?? 'null');

describe('Autosave', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('keeps every change in the browser at once and clears it once the server has it', async () => {
		const { storage, calls, save } = setup();
		save.change('a');
		expect(draftOf(storage).data).toBe('a'); // before any request
		expect(save.state).toBe('dirty');
		await vi.advanceTimersByTimeAsync(100);
		expect(calls).toHaveLength(1);
		calls[0].resolve('2026-11-17T10:00:01.000Z');
		await vi.advanceTimersByTimeAsync(0);
		expect(save.state).toBe('saved');
		expect(storage.map.has('k')).toBe(false);
	});

	it('retries a failed save until it succeeds, keeping the draft meanwhile', async () => {
		const { storage, calls, save } = setup();
		save.change('a');
		await vi.advanceTimersByTimeAsync(100);
		calls[0].reject(new Error('server down'));
		await vi.advanceTimersByTimeAsync(0);
		expect(save.state).toBe('error');
		expect(draftOf(storage).data).toBe('a');
		await vi.advanceTimersByTimeAsync(2000);
		expect(calls).toHaveLength(2);
		calls[1].resolve('2026-11-17T10:00:05.000Z');
		await vi.advanceTimersByTimeAsync(0);
		expect(save.state).toBe('saved');
		expect(storage.map.has('k')).toBe(false);
	});

	it('sends one request at a time, newest last, with growing revisions', async () => {
		const { storage, calls, save } = setup();
		save.change('a');
		await vi.advanceTimersByTimeAsync(100);
		save.change('b'); // while 'a' is in flight
		await vi.advanceTimersByTimeAsync(500);
		expect(calls).toHaveLength(1); // 'b' waits for 'a'
		calls[0].resolve('2026-11-17T10:00:01.000Z');
		await vi.advanceTimersByTimeAsync(100);
		expect(calls.map((c) => c.data)).toEqual(['a', 'b']);
		expect(calls[1].rev).toBeGreaterThan(calls[0].rev);
		expect(draftOf(storage)).toMatchObject({ data: 'b', base: '2026-11-17T10:00:01.000Z' });
	});

	it('restores a draft the server has not seen and drops one it superseded', () => {
		const storage = memoryStorage();
		storage.setItem(
			'k',
			JSON.stringify({ data: 'unsaved', base: '2026-11-17T10:00:00.000Z', at: 1 })
		);
		const mk = (base: string) =>
			new Autosave<string>({ key: 'k', base, storage, send: async () => base });
		expect(mk('2026-11-17T10:00:00.000Z').restore()).toBe('unsaved');
		// the server moved on (e.g. the last-chance save did arrive): the draft is stale
		expect(mk('2026-11-17T10:05:00.000Z').restore()).toBeNull();
		expect(storage.map.has('k')).toBe(false);
	});
});

describe('Autosave inside an effect', () => {
	it('does not make the effect depend on the save status (no save loop)', async () => {
		const { flushSync } = await import('svelte');
		const { effectRoot } = await import('./helpers/effectRoot.svelte.ts');
		const sends: string[] = [];
		const save = new Autosave<string>({
			key: 'k',
			base: '',
			delay: 0,
			storage: null,
			send: async (d) => {
				sends.push(d);
				return 'x';
			}
		});
		const runs = effectRoot(save, 'value');
		flushSync();
		await new Promise((r) => setTimeout(r, 50));
		flushSync();
		await new Promise((r) => setTimeout(r, 50));
		expect(runs()).toBe(1);
		expect(sends).toEqual(['value']);
	});
});
