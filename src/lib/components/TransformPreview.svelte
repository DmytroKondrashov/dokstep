<script lang="ts">
	import { previewTransform } from '#lib/api.js';
	import { isIdentity } from '#lib/transform.js';
	import type { Transform } from '#lib/types.js';

	/** Shows what `value` becomes after `transform` (computed on the server). */
	let {
		value,
		transform,
		result = $bindable('')
	}: { value: string; transform: Transform | undefined; result?: string } = $props();

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

<span class="font-paper text-[15px] text-ink">{result || '—'}</span>
