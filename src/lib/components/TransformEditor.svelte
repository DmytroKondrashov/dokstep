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
	const caseId = $derived(t.case ?? 'nom');
	const hasExtra = $derived(!!(t.letter || t.addDays || t.dateFormat));
	const ABBR: Record<string, string> = {
		nom: 'Н',
		gen: 'Р',
		dat: 'Д',
		acc: 'З',
		ins: 'О',
		loc: 'М',
		voc: 'К'
	};
</script>

<div class="grid gap-3">
	<fieldset>
		<legend class="label">Відмінок</legend>
		<div class="grid grid-cols-7 gap-1">
			{#each CASES as c (c.id)}
				<button
					type="button"
					title={c.label}
					aria-label={c.label}
					aria-pressed={caseId === c.id}
					class="h-9 cursor-pointer rounded-lg border text-sm font-semibold {caseId === c.id
						? 'border-accent bg-accent text-white'
						: 'border-line bg-surface text-ink-2 hover:bg-sunken'}"
					onclick={() => set({ case: c.id })}>{ABBR[c.id]}</button
				>
			{/each}
		</div>
		{#if caseId !== 'nom'}
			<div class="mt-2 flex flex-wrap items-center gap-1.5 text-[13px] text-muted">
				Відмінювати як:
				{#each DECLINE_AS as d (d.id)}
					<button type="button" class="pill h-7" aria-pressed={(t.declineAs ?? 'name') === d.id} onclick={() => set({ declineAs: d.id })}>
						{d.label}
					</button>
				{/each}
			</div>
		{/if}
	</fieldset>

	<fieldset>
		<legend class="label">Формат імені</legend>
		<div class="flex flex-wrap gap-1.5">
			{#each NAME_FORMATS as f (f.id)}
				<button type="button" class="pill" aria-pressed={(t.nameFormat ?? 'full') === f.id} onclick={() => set({ nameFormat: f.id })}>
					{f.label}
				</button>
			{/each}
		</div>
	</fieldset>

	<details class="group" open={hasExtra}>
		<summary class="cursor-pointer text-[13px] font-semibold text-ink-2 select-none">
			Регістр і дата{hasExtra ? ' · змінено' : ''}
		</summary>
		<div class="mt-2.5 grid gap-3">
			<fieldset>
				<legend class="label">Регістр</legend>
				<div class="flex flex-wrap gap-1.5">
					<button type="button" class="pill" aria-pressed={!t.letter} onclick={() => set({ letter: undefined })}>без змін</button>
					{#each LETTER_CASES as l (l.id)}
						<button type="button" class="pill" aria-pressed={t.letter === l.id} onclick={() => set({ letter: l.id })}>{l.label}</button>
					{/each}
				</div>
			</fieldset>
			<div class="grid grid-cols-[7rem_1fr] gap-2">
				<label>
					<span class="label">Дата ± днів</span>
					<input
						class="input h-9"
						type="number"
						value={t.addDays ?? ''}
						placeholder="0"
						oninput={(e) => set({ addDays: Number(e.currentTarget.value) || undefined })}
					/>
				</label>
				<label>
					<span class="label">Формат дати</span>
					<select
						class="input h-9"
						value={t.dateFormat ?? ''}
						onchange={(e) => set({ dateFormat: (e.currentTarget.value || undefined) as Transform['dateFormat'] })}
					>
						<option value="">як у значенні</option>
						{#each DATE_FORMATS as d (d.id)}<option value={d.id}>{d.label}</option>{/each}
					</select>
				</label>
			</div>
		</div>
	</details>
</div>
