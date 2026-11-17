<script lang="ts">
	import { beforeNavigate } from '$app/navigation';
	import { untrack } from 'svelte';
	import { api } from '#lib/api.js';
	import { Autosave, guardPage } from '#lib/autosave.svelte.js';
	import AppHeader from '#lib/components/AppHeader.svelte';
	import DocPreview from '#lib/components/DocPreview.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import SaveStatus from '#lib/components/SaveStatus.svelte';
	import { inheritedFields } from '#lib/editor.js';
	import { fillPreview } from '#lib/fillPreview.js';
	import { describeTransform } from '#lib/transform.js';
	import type { Field } from '#lib/types.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const wf = untrack(() => data.workflow);
	const previews = untrack(() => data.previews);
	const runId = untrack(() => data.run.id);
	type RunData = { name: string; values: Record<string, string> };
	type Saved = {
		updatedAt: string;
		resolved: Record<string, string>;
		markValues: Record<string, string>;
	};

	// Typed values are kept in the browser at once and saved in the background (see Autosave).
	const save = new Autosave<RunData>({
		key: `dokstep:run:${runId}`,
		base: untrack(() => data.run.updatedAt),
		delay: 350,
		send: async (d, o) => {
			const r = await api<Saved>(
				`/api/runs/${runId}`,
				'PUT',
				{ ...d, rev: o.rev },
				{ keepalive: o.keepalive }
			);
			resolved = r.resolved;
			markValues = r.markValues;
			return r.updatedAt;
		}
	});
	/** Values typed in this browser that never reached the server come back. */
	const draft = save.restore();
	let name = $state(untrack(() => draft?.name ?? data.run.name));
	const values = $state<Record<string, string>>(
		untrack(() => ({ ...(draft?.values ?? data.run.values) }))
	);
	let resolved = $state<Record<string, string>>(untrack(() => data.resolved));
	let markValues = $state<Record<string, string>>(untrack(() => data.markValues));
	let stepIndex = $state(0);
	let docId = $state<string | null>(null);
	let focusedField = $state<string | null>(null);
	const step = $derived(wf.steps[stepIndex]);
	const doc = $derived(step?.docs.find((d) => d.id === docId) ?? step?.docs[0]);

	/* ---------- autosave + resolve ---------- */
	let loaded = false;
	$effect(() => {
		const snap = { name, values: $state.snapshot(values) };
		// the first run only subscribes — unless a restored draft still has to reach the server
		if (!loaded) {
			loaded = true;
			if (!draft) return;
		}
		save.change(snap);
	});
	guardPage(save);
	beforeNavigate(() => {
		save.flush();
	});

	/* ---------- view data ---------- */
	const labels = new Map(wf.steps.flatMap((s) => s.fields).map((f) => [f.id, f.label]));
	const isAuto = (f: Field) => !values[f.id]?.trim() && !!f.defaultFrom;
	const isEmpty = (f: Field) => !resolved[f.id]?.trim();
	const emptyIn = (i: number) => wf.steps[i].fields.filter(isEmpty).length;
	const stepState = (i: number) => (i === stepIndex ? 'current' : emptyIn(i) ? 'todo' : 'done');
	const inherited = $derived(inheritedFields(wf.steps, stepIndex));
	const totalDocs = wf.steps.reduce((n, s) => n + s.docs.length, 0);

	const filled = $derived.by(() => {
		if (!doc || !previews[doc.id]) return null;
		const marks = step.marks.filter((m) => m.docId === doc.id);
		return fillPreview(
			previews[doc.id],
			marks.map((m) => ({
				id: m.id,
				para: m.para,
				start: m.start,
				end: m.end,
				value: markValues[m.id] ?? '',
				label: labels.get(m.fieldId) ?? '?'
			}))
		);
	});
	const active = $derived(
		new Set(
			focusedField ? step.marks.filter((m) => m.fieldId === focusedField).map((m) => m.id) : []
		)
	);

	function autoHint(f: Field) {
		if (!f.defaultFrom) return '';
		const t = describeTransform(f.defaultFrom.transform);
		return `${labels.get(f.defaultFrom.fieldId) ?? '?'}${t ? ` · ${t}` : ''}`;
	}

	let downloading = $state(false);
	let downloadError = $state(false);
	async function download(query: string) {
		downloading = true;
		try {
			await save.flush();
			// documents are built from what the server has: never hand out stale ones
			if (save.pending) {
				downloadError = true;
				return;
			}
			downloadError = false;
			const a = document.createElement('a');
			a.href = `/api/runs/${runId}/generate${query}`;
			a.download = '';
			a.click();
		} finally {
			setTimeout(() => (downloading = false), 800);
		}
	}

	function go(i: number) {
		stepIndex = i;
		docId = null;
		focusedField = null;
	}
</script>

<AppHeader crumbs={[{ href: '/', label: 'Процеси' }, { href: `/workflows/${wf.id}`, label: wf.name }]}>
	{#snippet title()}
		<input
			class="h-9 w-[min(24rem,50vw)] rounded-lg border border-transparent bg-transparent px-2 text-[17px] font-semibold hover:border-line focus:border-accent focus:bg-surface"
			bind:value={name}
			aria-label="Назва справи"
		/>
	{/snippet}
	{#snippet actions()}
		<SaveStatus state={save.state} />
		<button class="btn btn-primary" disabled={!totalDocs || downloading} onclick={() => download('')}>
			<Icon name="download" size={18} /> Усі документи (.zip)
		</button>
	{/snippet}
</AppHeader>

<nav aria-label="Кроки" class="border-b border-line bg-surface">
	<ol class="flex items-center gap-2 overflow-x-auto px-6 py-3">
		{#each wf.steps as s, i (s.id)}
			{@const st = stepState(i)}
			<li class="flex items-center gap-2">
				<button
					class="flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm {st === 'current'
						? 'bg-accent-soft font-semibold text-accent-ink'
						: 'hover:bg-sunken'}"
					aria-current={st === 'current' ? 'step' : undefined}
					onclick={() => go(i)}
				>
					<span
						class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold {st === 'current'
							? 'bg-accent text-white'
							: st === 'done'
								? 'bg-inh-line text-white'
								: 'bg-ground text-muted'}"
					>
						{#if st === 'done'}<Icon name="check" size={15} stroke={2.6} /><span class="sr-only">готово</span>{:else}{i + 1}{/if}
					</span>
					<span class="max-w-56 truncate">{s.name}</span>
				</button>
				{#if i < wf.steps.length - 1}<span class="h-px w-6 bg-line" aria-hidden="true"></span>{/if}
			</li>
		{/each}
	</ol>
</nav>

{#if step}
	<div class="flex flex-wrap items-start gap-6 px-6 pt-6 pb-12">
		<section aria-label="Дані кроку" class="flex min-w-0 flex-[1_1_440px] flex-col gap-4 lg:max-w-[540px]">
			{#if draft}
				<p class="flex items-start gap-2 rounded-xl bg-inh-soft px-4 py-3 text-sm text-inh-ink" role="status">
					<Icon name="check" size={18} class="mt-0.5" /> Відновлено введені дані, які не встигли зберегтися на сервері.
				</p>
			{/if}
			{#if downloadError}
				<p class="flex items-start gap-2 rounded-xl bg-own-soft px-4 py-3 text-sm text-own-ink" role="alert">
					<Icon name="alert" size={18} class="mt-0.5" />
					Сервер зараз недоступний, тож документи сформувати не можна. Введені дані збережено в браузері —
					спробуйте ще раз за хвилину.
				</p>
			{/if}
			<div>
				<p class="text-[13px] font-semibold text-muted">Крок {stepIndex + 1} з {wf.steps.length}</p>
				<h1 class="text-2xl font-bold tracking-tight">{step.name}</h1>
			</div>

			<div class="card grid gap-5 p-5">
				{#if !step.fields.length}
					<p class="text-sm text-muted">
						У цьому кроці нічого вводити не потрібно — усі дані беруться з попередніх кроків.
					</p>
				{/if}
				{#each step.fields as f (f.id)}
					{@const auto = isAuto(f)}
					<div>
						<label for="f-{f.id}" class="label flex items-center gap-2">
							{f.label}
							{#if auto}<span class="rounded-md bg-inh-soft px-1.5 py-px text-[11px] font-bold tracking-wide text-inh-ink uppercase">авто</span>{/if}
						</label>
						{#if f.multiline}
							<textarea
								id="f-{f.id}"
								class="input min-h-24"
								bind:value={values[f.id]}
								placeholder={auto ? resolved[f.id] : `напр.: ${f.example}`}
								onfocus={() => (focusedField = f.id)}
							></textarea>
						{:else}
							<input
								id="f-{f.id}"
								class="input"
								bind:value={values[f.id]}
								placeholder={auto ? resolved[f.id] : `напр.: ${f.example}`}
								onfocus={() => (focusedField = f.id)}
							/>
						{/if}
						{#if f.defaultFrom}
							<div class="mt-1.5 flex flex-wrap items-center gap-2 text-[13px] text-muted">
								{#if auto}
									<span class="flex-1">Автоматично: {autoHint(f)}</span>
									<button class="font-semibold text-accent hover:underline" onclick={() => (values[f.id] = resolved[f.id])}>
										Змінити вручну
									</button>
								{:else}
									<span class="flex-1">Введено вручну</span>
									<button class="font-semibold text-accent hover:underline" onclick={() => (values[f.id] = '')}>
										Повернути автоматичне
									</button>
								{/if}
							</div>
						{/if}
					</div>
				{/each}
			</div>

			{#if inherited.length}
				<section class="card p-5">
					<h2 class="section-title mb-3">З попередніх кроків</h2>
					<dl class="grid gap-y-2.5 text-sm">
						{#each inherited as o (o.field.id)}
							<div class="grid grid-cols-[minmax(0,11rem)_1fr_auto] items-baseline gap-3">
								<dt class="text-muted">{o.field.label}</dt>
								<dd class="min-w-0 font-paper text-base break-words whitespace-pre-wrap">
									{#if resolved[o.field.id]}{resolved[o.field.id]}{:else}<span class="font-sans text-sm text-danger">не заповнено</span>{/if}
								</dd>
								<button class="text-[13px] font-semibold text-accent hover:underline" onclick={() => go(o.stepIndex)}>
									крок {o.stepIndex + 1}
								</button>
							</div>
						{/each}
					</dl>
				</section>
			{/if}

			<section class="card p-5">
				<h2 class="section-title mb-3">Документи кроку</h2>
				{#if emptyIn(stepIndex)}
					<p class="mb-3 flex items-center gap-2 rounded-[10px] bg-own-soft px-3 py-2 text-[13px] text-own-ink">
						<Icon name="alert" /> Порожніх полів: {emptyIn(stepIndex)} — у документах ці місця залишаться порожніми.
					</p>
				{/if}
				<ul class="mb-4 grid gap-2">
					{#each step.docs as d (d.id)}
						<li class="flex items-center gap-3 rounded-[10px] border border-line-soft p-2.5 text-sm">
							<Icon name="file" size={18} class="text-muted" />
							<span class="min-w-0 flex-1 truncate">{d.name}</span>
							<button class="btn btn-sm" disabled={downloading} onclick={() => download(`?step=${step.id}&doc=${d.id}`)}>
								<Icon name="download" /> .{d.format ?? 'docx'}
							</button>
						</li>
					{/each}
				</ul>
				<div class="flex flex-wrap justify-between gap-2">
					<button class="btn" disabled={stepIndex === 0} onclick={() => go(stepIndex - 1)}>
						<Icon name="chevron-left" /> Назад
					</button>
					<div class="flex flex-wrap gap-2">
						{#if step.docs.length > 1}
							<button class="btn" disabled={downloading} onclick={() => download(`?step=${step.id}`)}>Усі документи кроку</button>
						{/if}
						{#if stepIndex < wf.steps.length - 1}
							<button class="btn btn-primary" onclick={() => go(stepIndex + 1)}>Далі <Icon name="chevron" /></button>
						{:else}
							<button class="btn btn-primary" disabled={downloading} onclick={() => download('')}>
								<Icon name="download" /> Завантажити все
							</button>
						{/if}
					</div>
				</div>
			</section>
		</section>

		<section aria-label="Попередній перегляд" class="min-w-0 flex-[999_1_560px]">
			<div class="mb-3 flex flex-wrap items-center gap-3">
				<h2 class="section-title">Попередній перегляд</h2>
				{#if step.docs.length > 1}
					<div class="segmented" role="tablist" aria-label="Документи кроку">
						{#each step.docs as d (d.id)}
							<button role="tab" aria-selected={d.id === doc?.id} class="max-w-56 truncate" onclick={() => (docId = d.id)}>{d.name}</button>
						{/each}
					</div>
				{/if}
				<span class="flex-1"></span>
				<span class="flex items-center gap-3 text-[13px] text-muted">
					<span class="flex items-center gap-1.5"><span class="h-3 w-4 rounded-sm bg-accent-soft shadow-[inset_0_-2px_0_color-mix(in_srgb,var(--color-accent)_55%,transparent)]"></span>значення</span>
					<span class="flex items-center gap-1.5"><span class="h-3 w-4 rounded-sm border border-dashed border-own-line bg-own-soft"></span>не заповнено</span>
				</span>
			</div>
			{#if filled}
				<DocPreview preview={filled.preview} ranges={filled.ranges} {active} />
			{:else}
				<p class="card p-6 text-sm text-muted">У цього кроку немає документів.</p>
			{/if}
		</section>
	</div>
{/if}
