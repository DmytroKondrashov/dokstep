<script lang="ts">
	import type { SaveState } from '#lib/autosave.svelte.js';
	import Icon from './Icon.svelte';

	let { state }: { state: SaveState } = $props();
</script>

<span class="flex items-center gap-1.5 text-sm" role="status">
	{#if state === 'saved'}
		<span class="flex items-center gap-1.5 text-inh-ink"><Icon name="check" stroke={2.4} /> Збережено</span>
	{:else if state === 'error' || state === 'offline'}
		<span
			class="flex items-center gap-1.5 text-own-ink"
			title="Зміни збережено в цьому браузері й буде надіслано на сервер, щойно з’явиться зв’язок. Їх не втрачено навіть після перезавантаження."
		>
			<Icon name="alert" />
			{state === 'offline' ? 'Немає зв’язку' : 'Сервер недоступний'} — збережено в браузері, повтор…
		</span>
	{:else}
		<span class="text-muted">Збереження…</span>
	{/if}
</span>
