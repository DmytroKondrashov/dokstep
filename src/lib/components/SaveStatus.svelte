<script lang="ts">
	import Icon from './Icon.svelte';

	let { state }: { state: 'saved' | 'dirty' | 'saving' | 'error' } = $props();
</script>

<span class="flex items-center gap-1.5 text-sm" role="status">
	{#if state === 'saved'}
		<span class="flex items-center gap-1.5 text-inh-ink"><Icon name="check" stroke={2.4} /> Збережено</span>
	{:else if state === 'error'}
		<span class="flex items-center gap-1.5 text-danger"><Icon name="alert" /> Не збережено</span>
	{:else}
		<span class="text-muted">Збереження…</span>
	{/if}
</span>
