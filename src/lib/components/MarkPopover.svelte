<script lang="ts">
	import { untrack } from 'svelte';
	import { availableFields, fieldLocation, suggestLabel } from '#lib/editor.js';
	import type { Mark, Step, Transform } from '#lib/types.js';
	import TransformEditor from './TransformEditor.svelte';
	import TransformPreview from './TransformPreview.svelte';

	type Mode =
		| {
				kind: 'new';
				text: string;
				rect: DOMRect;
				occurrences: number;
				fieldId?: string;
				transform?: Transform;
		  }
		| { kind: 'mark'; mark: Mark; rect: DOMRect };

	interface Props {
		mode: Mode;
		steps: Step[];
		stepIndex: number;
		oncreate: (
			f: { label: string; example: string; multiline: boolean; transform?: Transform },
			all: boolean
		) => void;
		onlink: (fieldId: string, transform: Transform | undefined, all: boolean) => void;
		onupdate: (patch: Partial<Mark>) => void;
		ondelete: () => void;
		onclose: () => void;
	}

	let { mode, steps, stepIndex, oncreate, onlink, onupdate, ondelete, onclose }: Props = $props();

	const options = $derived(availableFields(steps, stepIndex));
	const groups = $derived(
		[...new Set(options.map((o) => o.stepIndex))].map((i) => ({
			name: i === stepIndex ? 'Цей крок' : `Крок ${i + 1}: ${steps[i].name}`,
			fields: options.filter((o) => o.stepIndex === i).map((o) => o.field)
		}))
	);

	/* ---------- new selection (the parent re-creates the popover per selection) ---------- */
	const initial = untrack(() => (mode.kind === 'new' ? mode : null));
	let tab = $state<'create' | 'link'>(initial?.fieldId ? 'link' : 'create');
	let label = $state(initial ? suggestLabel(initial.text) : '');
	let multiline = $state(initial?.text.includes('\n') ?? false);
	// The fragment may be a derived form (e.g. genitive); the field keeps the base form.
	let example = $state(initial?.text ?? '');
	let createTransform = $state<Transform | undefined>(undefined);
	let isDerived = $state(false);
	let all = $state(true);
	let linkField = $state(initial?.fieldId ?? '');
	let linkTransform = $state<Transform | undefined>(initial?.transform);

	/* ---------- existing mark ---------- */
	const mark = $derived(mode.kind === 'mark' ? mode.mark : null);
	const loc = $derived(fieldLocation(steps, mark?.fieldId ?? linkField));

	let box: HTMLElement;
	const pos = $derived.by(() => {
		const r = mode.rect;
		const w = 400;
		const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
		const below = r.bottom + 8;
		return below + 360 < window.innerHeight
			? `left:${left}px;top:${below}px;width:${w}px`
			: `left:${left}px;bottom:${window.innerHeight - r.top + 8}px;width:${w}px`;
	});

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
	}
	function onpointerdown(e: PointerEvent) {
		if (
			box &&
			!box.contains(e.target as Node) &&
			!(e.target as HTMLElement).closest('[data-range]')
		)
			onclose();
	}
	const focus = (el: HTMLInputElement) => {
		el.focus();
		el.select();
	};
</script>

<svelte:window {onkeydown} {onpointerdown} />

<div bind:this={box} class="card fixed z-50 p-3 shadow-xl" style={pos}>
	{#if mode.kind === 'new'}
		<p class="mb-2 line-clamp-3 rounded bg-slate-100 px-2 py-1 font-serif text-sm">{mode.text}</p>
		<div class="mb-3 flex gap-1 text-sm">
			<button class="btn btn-sm" class:btn-primary={tab === 'create'} onclick={() => (tab = 'create')}>
				Нове поле
			</button>
			<button
				class="btn btn-sm"
				class:btn-primary={tab === 'link'}
				disabled={!options.length}
				onclick={() => (tab = 'link')}
			>
				Взяти з поля…
			</button>
		</div>

		{#if tab === 'create'}
			<form
				onsubmit={(e) => {
					e.preventDefault();
					if (label.trim())
						oncreate(
							{ label: label.trim(), example: isDerived ? example : (initial?.text ?? ''), multiline, transform: isDerived ? createTransform : undefined },
							all
						);
				}}
				class="grid gap-2"
			>
				<label>
					<span class="label">Назва поля (буде у формі заповнення)</span>
					<input class="input" bind:value={label} use:focus />
				</label>
				<label class="flex items-center gap-2 text-sm">
					<input type="checkbox" bind:checked={multiline} /> Багаторядкове
				</label>
				<label class="flex items-center gap-2 text-sm">
					<input type="checkbox" bind:checked={isDerived} /> Фрагмент — похідна форма (відмінок, формат)
				</label>
				{#if isDerived}
					<div class="grid gap-2 rounded-md bg-slate-50 p-2">
						<label>
							<span class="label">Значення поля в базовій формі (як вводитиметься)</span>
							<input class="input" bind:value={example} placeholder="напр. КОВАЛЕНКО Пилип Ількович" />
						</label>
						<span class="label">Форма цього фрагмента</span>
						<TransformEditor value={createTransform} onchange={(t) => (createTransform = t)} />
						<p class="text-xs text-slate-500">
							Перевірка: <TransformPreview value={example} transform={createTransform} />
						</p>
					</div>
				{/if}
				{#if mode.occurrences > 1}
					<label class="flex items-center gap-2 text-sm">
						<input type="checkbox" bind:checked={all} /> Позначити всі такі фрагменти в документах кроку ({mode.occurrences})
					</label>
				{/if}
				<p class="text-xs text-slate-500">Поле заповнюється при формуванні документів (жовте).</p>
				<button class="btn btn-primary justify-center">Створити поле</button>
			</form>
		{:else}
			<div class="grid gap-2">
				<label>
					<span class="label">Поле</span>
					<select class="input" bind:value={linkField}>
						<option value="" disabled>— оберіть —</option>
						{#each groups as g (g.name)}
							<optgroup label={g.name}>
								{#each g.fields as f (f.id)}<option value={f.id}>{f.label}</option>{/each}
							</optgroup>
						{/each}
					</select>
				</label>
				<TransformEditor value={linkTransform} onchange={(t) => (linkTransform = t)} />
				{#if loc}
					<p class="text-xs text-slate-500">
						Приклад: <TransformPreview value={loc.field.example} transform={linkTransform} />
					</p>
				{/if}
				{#if mode.occurrences > 1}
					<label class="flex items-center gap-2 text-sm">
						<input type="checkbox" bind:checked={all} /> Усі такі фрагменти ({mode.occurrences})
					</label>
				{/if}
				<button
					class="btn btn-primary justify-center"
					disabled={!linkField}
					onclick={() => onlink(linkField, linkTransform, all)}
				>
					Пов’язати
				</button>
			</div>
		{/if}
	{:else if mark}
		<div class="mb-2 flex items-start gap-2">
			<div class="flex-1 text-sm">
				<div class="font-medium">{loc?.field.label ?? 'Поле видалено'}</div>
				<div class="text-xs text-slate-500">
					{#if loc && loc.stepIndex === stepIndex}
						поле цього кроку — вводиться
					{:else if loc}
						з кроку {loc.stepIndex + 1}: {steps[loc.stepIndex].name}
					{/if}
				</div>
			</div>
			<button class="btn btn-sm" onclick={onclose} aria-label="Закрити">✕</button>
		</div>
		<label class="mb-2 block">
			<span class="label">Поле</span>
			<select class="input" value={mark.fieldId} onchange={(e) => onupdate({ fieldId: e.currentTarget.value })}>
				{#each groups as g (g.name)}
					<optgroup label={g.name}>
						{#each g.fields as f (f.id)}<option value={f.id}>{f.label}</option>{/each}
					</optgroup>
				{/each}
			</select>
		</label>
		<TransformEditor value={mark.transform} onchange={(t) => onupdate({ transform: t })} />
		{#if loc}
			<p class="mt-2 text-xs text-slate-500">
				Приклад: <TransformPreview value={loc.field.example} transform={mark.transform} />
			</p>
		{/if}
		<div class="mt-3 flex justify-between">
			<button class="btn btn-sm btn-danger" onclick={ondelete}>Зняти позначку</button>
			<button class="btn btn-sm btn-primary" onclick={onclose}>Готово</button>
		</div>
	{/if}
</div>
