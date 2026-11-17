<script lang="ts">
	import { untrack } from 'svelte';
	import { availableFields, fieldLocation, suggestLabel } from '#lib/editor.js';
	import type { Mark, Step, Transform } from '#lib/types.js';
	import TransformEditor from './TransformEditor.svelte';
	import Icon from './Icon.svelte';
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
		| { kind: 'mark'; mark: Mark; text: string; rect: DOMRect };

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
	const own = $derived(!!loc && loc.stepIndex === stepIndex);

	/** What the example becomes with the chosen form, to compare with the selected text. */
	let produced = $state('');
	const target = $derived(mode.text.trim());
	const matches = $derived(!!produced && produced.trim() === target);

	let box: HTMLElement;
	const W = 400;
	const pos = $derived.by(() => {
		const r = mode.rect;
		const left = Math.max(12, Math.min(r.left, window.innerWidth - W - 12));
		const below = window.innerHeight - r.bottom - 20;
		const above = r.top - 20;
		return below >= 420 || below >= above
			? `left:${left}px;top:${r.bottom + 8}px;max-height:${Math.max(below, 260)}px`
			: `left:${left}px;bottom:${window.innerHeight - r.top + 8}px;max-height:${above}px`;
	});

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
	}
	function onpointerdown(e: PointerEvent) {
		const t = e.target as HTMLElement;
		if (box && !box.contains(t) && !t.closest('[data-range]') && !t.closest('.chip')) onclose();
	}
	const focus = (el: HTMLInputElement) => {
		el.focus();
		el.select();
	};
</script>

<svelte:window {onkeydown} {onpointerdown} />

{#snippet check(value: string, transform: Transform | undefined)}
	<div class="flex items-start gap-2.5 rounded-[10px] px-3 py-2.5 text-[13px] {matches ? 'bg-[#e9f6ef] text-inh-ink' : 'bg-own-soft text-own-ink'}">
		<Icon name={matches ? 'check' : 'alert'} size={18} stroke={2.2} class="mt-px" />
		<span>
			Зі зразка «{value}» вийде <TransformPreview {value} {transform} bind:result={produced} />
			{matches ? '— збігається з виділеним.' : '— не збігається з виділеним. Перевірте відмінок і формат.'}
		</span>
	</div>
{/snippet}

{#snippet fieldSelect(value: string, onchange: (id: string) => void)}
	<label class="block">
		<span class="label">Поле</span>
		<select class="input" {value} onchange={(e) => onchange(e.currentTarget.value)}>
			<option value="" disabled>— оберіть поле —</option>
			{#each groups as g (g.name)}
				<optgroup label={g.name}>
					{#each g.fields as f (f.id)}<option value={f.id}>{f.label}</option>{/each}
				</optgroup>
			{/each}
		</select>
	</label>
{/snippet}

<div
	bind:this={box}
	role="dialog"
	aria-label={mode.kind === 'new' ? 'Позначити фрагмент' : 'Позначка'}
	class="fixed z-50 flex w-[400px] max-w-[calc(100vw-24px)] flex-col gap-3.5 overflow-y-auto rounded-[14px] border border-[#d4d9e1] bg-surface p-4 shadow-[0_2px_4px_rgb(22_27_38/0.06),0_16px_40px_rgb(22_27_38/0.16)]"
	style={pos}
>
	<div class="flex items-start gap-2.5">
		<div class="min-w-0 flex-1">
			<div class="mb-0.5 text-xs text-muted">
				{#if mode.kind === 'new'}Виділений фрагмент{:else if own}Поле цього кроку — вводиться{:else if loc}З кроку {loc.stepIndex + 1}: {steps[loc.stepIndex].name}{:else}Поле видалено{/if}
			</div>
			<div class="line-clamp-3 font-paper text-[17px]">{mode.text}</div>
		</div>
		<button class="btn btn-ghost btn-icon bg-ground" aria-label="Закрити" onclick={onclose}><Icon name="x" /></button>
	</div>

	{#if mode.kind === 'new'}
		<div class="segmented grid grid-cols-2">
			<button aria-pressed={tab === 'create'} onclick={() => (tab = 'create')}>Нове поле</button>
			<button aria-pressed={tab === 'link'} disabled={!options.length} onclick={() => (tab = 'link')}>Взяти з поля</button>
		</div>

		{#if tab === 'create'}
			<form
				class="grid gap-3"
				onsubmit={(e) => {
					e.preventDefault();
					if (!label.trim()) return;
					oncreate(
						{
							label: label.trim(),
							example: isDerived ? example : (initial?.text ?? ''),
							multiline,
							transform: isDerived ? createTransform : undefined
						},
						all
					);
				}}
			>
				<label>
					<span class="label">Назва поля — так воно звучатиме у формі</span>
					<input class="input" bind:value={label} use:focus />
				</label>
				<div class="flex flex-col gap-2 text-sm">
					<label class="flex items-center gap-2"><input type="checkbox" bind:checked={multiline} /> Багаторядкове</label>
					<label class="flex items-center gap-2">
						<input type="checkbox" bind:checked={isDerived} /> Фрагмент у похідній формі (відмінок, формат)
					</label>
					{#if mode.occurrences > 1}
						<label class="flex items-center gap-2">
							<input type="checkbox" bind:checked={all} /> Позначити всі такі ж у документах кроку ({mode.occurrences})
						</label>
					{/if}
				</div>
				{#if isDerived}
					<div class="grid gap-3 rounded-xl border border-line bg-sunken p-3">
						<label>
							<span class="label">Значення в базовій формі — як його вводитимуть</span>
							<input class="input" bind:value={example} placeholder="напр. Петренко Олена Іванівна" />
						</label>
						<TransformEditor value={createTransform} onchange={(t) => (createTransform = t)} />
						{@render check(example, createTransform)}
					</div>
				{/if}
				<div class="flex justify-end gap-2">
					<button type="button" class="btn" onclick={onclose}>Скасувати</button>
					<button class="btn btn-primary">Створити поле</button>
				</div>
			</form>
		{:else}
			<div class="grid gap-3">
				{@render fieldSelect(linkField, (id) => (linkField = id))}
				<TransformEditor value={linkTransform} onchange={(t) => (linkTransform = t)} />
				{#if loc}{@render check(loc.field.example, linkTransform)}{/if}
				{#if mode.occurrences > 1}
					<label class="flex items-center gap-2 text-sm">
						<input type="checkbox" bind:checked={all} /> Усі такі фрагменти ({mode.occurrences})
					</label>
				{/if}
				<div class="flex justify-end gap-2">
					<button class="btn" onclick={onclose}>Скасувати</button>
					<button class="btn btn-primary" disabled={!linkField} onclick={() => onlink(linkField, linkTransform, all)}>Пов’язати</button>
				</div>
			</div>
		{/if}
	{:else if mark}
		{@render fieldSelect(mark.fieldId, (id) => onupdate({ fieldId: id }))}
		<TransformEditor value={mark.transform} onchange={(t) => onupdate({ transform: t })} />
		{#if loc}{@render check(loc.field.example, mark.transform)}{/if}
		<div class="flex justify-between gap-2">
			<button class="btn btn-danger" onclick={ondelete}><Icon name="trash" /> Зняти позначку</button>
			<button class="btn btn-primary" onclick={onclose}>Готово</button>
		</div>
	{/if}
</div>
