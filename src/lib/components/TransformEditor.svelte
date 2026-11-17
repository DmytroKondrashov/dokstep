<script lang="ts">
	import {
		CASES,
		DATE_FORMATS,
		DECLINE_AS,
		LETTER_CASES,
		NAME_FORMATS,
		cleanTransform
	} from '#lib/transform.js';
	import type { Transform } from '#lib/types.js';

	interface Props {
		value: Transform | undefined;
		onchange: (t: Transform | undefined) => void;
	}

	let { value, onchange }: Props = $props();

	const t = $derived(value ?? {});
	const set = (patch: Partial<Transform>) => onchange(cleanTransform({ ...t, ...patch }));
	const sel = (e: Event) => (e.currentTarget as HTMLSelectElement).value || undefined;
</script>

<div class="grid grid-cols-2 gap-2 text-xs">
	<label>
		<span class="label">Відмінок</span>
		<select class="input" value={t.case ?? 'nom'} onchange={(e) => set({ case: sel(e) as Transform['case'] })}>
			{#each CASES as c (c.id)}<option value={c.id}>{c.label}</option>{/each}
		</select>
	</label>
	<label>
		<span class="label">Відмінювати як</span>
		<select
			class="input"
			disabled={!t.case || t.case === 'nom'}
			value={t.declineAs ?? 'name'}
			onchange={(e) => set({ declineAs: sel(e) as Transform['declineAs'] })}
		>
			{#each DECLINE_AS as d (d.id)}<option value={d.id}>{d.label}</option>{/each}
		</select>
	</label>
	<label>
		<span class="label">Формат імені</span>
		<select class="input" value={t.nameFormat ?? 'full'} onchange={(e) => set({ nameFormat: sel(e) as Transform['nameFormat'] })}>
			{#each NAME_FORMATS as f (f.id)}<option value={f.id}>{f.label}</option>{/each}
		</select>
	</label>
	<label>
		<span class="label">Регістр</span>
		<select class="input" value={t.letter ?? ''} onchange={(e) => set({ letter: sel(e) as Transform['letter'] })}>
			<option value="">без змін</option>
			{#each LETTER_CASES as l (l.id)}<option value={l.id}>{l.label}</option>{/each}
		</select>
	</label>
	<label>
		<span class="label">Дата: зсув, днів</span>
		<input
			class="input"
			type="number"
			value={t.addDays ?? ''}
			placeholder="0"
			oninput={(e) => set({ addDays: Number((e.currentTarget as HTMLInputElement).value) || undefined })}
		/>
	</label>
	<label>
		<span class="label">Формат дати</span>
		<select class="input" value={t.dateFormat ?? ''} onchange={(e) => set({ dateFormat: sel(e) as Transform['dateFormat'] })}>
			<option value="">як є</option>
			{#each DATE_FORMATS as d (d.id)}<option value={d.id}>{d.label}</option>{/each}
		</select>
	</label>
</div>
