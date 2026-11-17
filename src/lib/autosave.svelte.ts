/**
 * Autosave that never loses edits.
 *
 * 1. Every change is written to localStorage at once (synchronous — survives a reload,
 *    a closed browser, or the server being down) together with `base`: the server's
 *    `updatedAt` the draft was made on top of.
 * 2. The latest snapshot is sent to the server, one request at a time, retried with
 *    backoff until it succeeds. Each carries `rev`; the server drops older revisions, so a
 *    late request can never overwrite a newer save.
 * 3. When the page is hidden or closed, a last `keepalive` request goes out.
 * 4. On load, `restore()` hands back a draft the server has not seen yet; a draft whose
 *    base is older than the server's version was already saved (or superseded) and is dropped.
 */

import { untrack } from 'svelte';

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error' | 'offline';

interface Draft<T> {
	data: T;
	/** Server `updatedAt` the draft builds on. */
	base: string;
	at: number;
}

export interface AutosaveOptions<T> {
	/** localStorage key, unique per document, e.g. `dokstep:workflow:<id>`. */
	key: string;
	/** Server `updatedAt` of the version the page loaded. */
	base: string;
	/**
	 * Send a snapshot; resolves with the server's `updatedAt`. `rev` (when the snapshot was
	 * taken) lets the server ignore a request that arrives after a newer one.
	 */
	send: (data: T, o: { rev: number; keepalive: boolean }) => Promise<string>;
	delay?: number;
	storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
}

function defaultStorage() {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage;
	} catch {
		return null; // blocked storage (private mode, policies)
	}
}

export class Autosave<T> {
	state = $state<SaveState>('saved');

	#key: string;
	#base: string;
	#send: AutosaveOptions<T>['send'];
	#delay: number;
	#storage: AutosaveOptions<T>['storage'];
	#latest: T | null = null;
	#rev = 0;
	#dirty = false;
	#inflight: Promise<void> | null = null;
	#timer: ReturnType<typeof setTimeout> | undefined;
	#retry = 0;

	constructor(o: AutosaveOptions<T>) {
		this.#key = o.key;
		this.#base = o.base;
		this.#send = o.send;
		this.#delay = o.delay ?? 500;
		this.#storage = o.storage === undefined ? defaultStorage() : o.storage;
	}

	/** A local draft the server does not have yet, or null (stale drafts are removed). */
	restore(): T | null {
		const raw = this.#read();
		if (!raw) return null;
		if (raw.base < this.#base) {
			this.#clear();
			return null;
		}
		return raw.data;
	}

	/** Record a change: stored locally right away, sent to the server shortly. */
	change(data: T) {
		this.#latest = data;
		this.#rev = Math.max(Date.now(), this.#rev + 1);
		this.#dirty = true;
		this.#write();
		// untracked: change() is called from page effects, which must not depend on the status
		untrack(() => {
			if (this.state === 'saved' || this.state === 'saving') this.state = 'dirty';
		});
		this.#schedule(this.#retry || this.#delay);
	}

	/** True while there are edits the server has not confirmed. */
	get pending() {
		return this.#dirty || this.#inflight !== null;
	}

	/** Send now and wait (e.g. before a download that reads the saved data). */
	async flush(): Promise<void> {
		clearTimeout(this.#timer);
		await this.#run();
		if (this.#inflight) await this.#inflight;
	}

	/** Page is going away: fire a request the browser keeps alive; the draft covers failure. */
	flushOnExit() {
		clearTimeout(this.#timer);
		if (!this.#dirty || this.#latest === null) return;
		this.#send(this.#latest, { rev: this.#rev, keepalive: true }).then(
			(base) => {
				this.#base = base;
				this.#clear();
			},
			() => {}
		);
	}

	/** Retry right away (connection is back). */
	retryNow() {
		if (this.#dirty) {
			this.#retry = 0;
			this.#schedule(0);
		}
	}

	#schedule(ms: number) {
		clearTimeout(this.#timer);
		this.#timer = setTimeout(() => void this.#run(), ms);
	}

	async #run(): Promise<void> {
		while (this.#inflight) await this.#inflight;
		if (!this.#dirty || this.#latest === null) return;
		const data = this.#latest;
		const rev = this.#rev;
		this.#dirty = false;
		this.state = 'saving';
		this.#inflight = this.#send(data, { rev, keepalive: false })
			.then(
				(base) => {
					this.#base = base;
					this.#retry = 0;
					if (this.#dirty) {
						this.#write(); // newer edits keep their draft, now on the new base
						this.#schedule(this.#delay);
					} else {
						this.#clear();
						this.state = 'saved';
					}
				},
				() => {
					this.#dirty = true;
					this.state = globalThis.navigator?.onLine === false ? 'offline' : 'error';
					this.#retry = Math.min(Math.max(this.#retry * 2, 2000), 30000);
					this.#schedule(this.#retry);
				}
			)
			.finally(() => {
				this.#inflight = null;
			});
		await this.#inflight;
	}

	#read(): Draft<T> | null {
		try {
			const raw = this.#storage?.getItem(this.#key);
			return raw ? (JSON.parse(raw) as Draft<T>) : null;
		} catch {
			return null;
		}
	}

	#write() {
		if (this.#latest === null) return;
		try {
			const draft: Draft<T> = { data: this.#latest, base: this.#base, at: Date.now() };
			this.#storage?.setItem(this.#key, JSON.stringify(draft));
		} catch {
			// quota exceeded / blocked: the server save still runs
		}
	}

	#clear() {
		try {
			this.#storage?.removeItem(this.#key);
		} catch {}
	}
}

/**
 * Wire an Autosave to the page lifecycle: last-chance save on hide/close, retry when the
 * connection returns, and a "leave page?" prompt while edits are unconfirmed.
 * Call from a component (uses $effect for cleanup).
 */
export function guardPage(save: Pick<Autosave<unknown>, 'flushOnExit' | 'retryNow' | 'pending'>) {
	$effect(() => {
		const onHide = () => {
			if (document.visibilityState === 'hidden') save.flushOnExit();
		};
		const onPageHide = () => save.flushOnExit();
		const onOnline = () => save.retryNow();
		const onBeforeUnload = (e: BeforeUnloadEvent) => {
			if (save.pending) e.preventDefault();
		};
		document.addEventListener('visibilitychange', onHide);
		window.addEventListener('pagehide', onPageHide);
		window.addEventListener('online', onOnline);
		window.addEventListener('beforeunload', onBeforeUnload);
		return () => {
			document.removeEventListener('visibilitychange', onHide);
			window.removeEventListener('pagehide', onPageHide);
			window.removeEventListener('online', onOnline);
			window.removeEventListener('beforeunload', onBeforeUnload);
		};
	});
}
