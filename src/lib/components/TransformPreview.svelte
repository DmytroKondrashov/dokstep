<script lang="ts">
	import { previewTransform } from '#lib/api.js';
	import { isIdentity } from '#lib/transform.js';
	import type { Transform } from '#lib/types.js';

	/** Shows what `value` becomes after `transform` (computed on the server). */
	let { value, transform }: { value: string; transform: Transform | undefined } = $props();

	let result = $state('');
	$effect(() => {
		const v = value;
		const t = transform;
		if (!v || isIdentity(t)) {
			result = v;
			return;
		}
		let stale = false;
		previewTransform(v, t)
			.then((r) => {
				if (!stale) result = r;
			})
			.catch(() => {});
		return () => {
			stale = true;
		};
	});
</script>

<span class="font-serif">{result || '—'}</span>
