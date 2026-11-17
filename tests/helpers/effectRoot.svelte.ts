import type { Autosave } from '../../src/lib/autosave.svelte.ts';

/** Calls save.change() from an effect, like the pages do; returns how often it ran. */
export function effectRoot(save: Autosave<string>, value: string) {
	let runs = 0;
	$effect.root(() => {
		$effect(() => {
			runs++;
			save.change(value);
		});
	});
	return () => runs;
}
