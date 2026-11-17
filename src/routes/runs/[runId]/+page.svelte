<script lang="ts">
	import { beforeNavigate } from '$app/navigation';
	import { untrack } from 'svelte';
	import { api, debounce } from '#lib/api.js';
	import { inheritedFields } from '#lib/editor.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const wf = untrack(() => data.workflow);
	const runId = untrack(() => data.run.id);
	let name = $state(untrack(() => data.run.name));
	const values = $state<Record<string, string>>(untrack(() => ({ ...data.run.values })));
	let resolved = $state<Record<string, string>>(untrack(() => data.resolved));
	let stepIndex = $state(0);
	const step = $derived(wf.steps[stepIndex]);

	/* ---------- autosave + resolve ---------- */
	let saveState = $state<'saved' | 'dirty' | 'saving' | 'error'>('saved');
	const save = debounce(async () => {
		saveState = 'saving';
		try {
			const r = await api<{ resolved: Record<string, string> }>(`/api/runs/${runId}`, 'PUT', {
				name,
				values: $state.snapshot(values)
			});
			resolved = r.resolved;
			saveState = save.pending() ? 'dirty' : 'saved';
		} catch {
			saveState = 'error';
		}
	}, 400);
	let loaded = false;
	$effect(() => {
		JSON.stringify(values);
		void name;
		if (!loaded) {
			loaded = true;
			return;
		}
		saveState = 'dirty';
		save();
	});
	beforeNavigate(() => {
		save.flush();
	});

	const isAuto = (id: string) => !values[id]?.trim();
	const stepEmpty = (i: number) => wf.steps[i].fields.filter((f) => !resolved[f.id]?.trim()).length;
	const inherited = $derived(inheritedFields(wf.steps, stepIndex));
	const totalDocs = wf.steps.reduce((n, s) => n + s.docs.length, 0);

	let downloading = $state(false);
	async function download(query: string) {
		downloading = true;
		try {
			await save.flush();
			const a = document.createElement('a');
			a.href = `/api/runs/${runId}/generate${query}`;
			a.download = '';
			a.click();
		} finally {
			setTimeout(() => (downloading = false), 800);
		}
	}
</script>

<div class="flex h-[calc(100vh-3rem)] flex-col">
	<div class="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2">
		<a href="/" class="btn btn-sm">← Головна</a>
		<input class="input max-w-md font-semibold" bind:value={name} aria-label="Назва справи" />
		<span class="text-xs text-slate-500">
			{wf.name} ·
			{#if saveState === 'saved'}збережено{:else if saveState === 'error'}<span class="text-red-600">помилка збереження</span>{:else}збереження…{/if}
		</span>
		<div class="ml-auto flex gap-2">
			<a href="/workflows/{wf.id}" class="btn">Редагувати процес</a>
			<button class="btn btn-primary" disabled={!totalDocs || downloading} onclick={() => download('')}>
				⤓ Усі документи (.zip)
			</button>
		</div>
	</div>

	<div class="grid min-h-0 flex-1 grid-cols-[16rem_1fr]">
		<nav class="overflow-auto border-r border-slate-200 bg-white p-3">
			<ol class="grid gap-1">
				{#each wf.steps as s, i (s.id)}
					{@const empty = stepEmpty(i)}
					<li>
						<button
							class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm {i === stepIndex
								? 'bg-blue-50 text-blue-800'
								: 'hover:bg-slate-100'}"
							onclick={() => (stepIndex = i)}
						>
							<span
								class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs {empty
									? 'bg-slate-200 text-slate-600'
									: 'bg-green-600 text-white'}">{empty ? i + 1 : '✓'}</span
							>
							<span class="min-w-0 flex-1 truncate">{s.name}</span>
						</button>
					</li>
				{/each}
			</ol>
		</nav>

		<main class="overflow-auto p-6">
			{#if step}
				<div class="mx-auto max-w-3xl">
					<h1 class="mb-1 text-xl font-semibold">{stepIndex + 1}. {step.name}</h1>
					<p class="mb-6 text-sm text-slate-500">
						Документи: {step.docs.map((d) => d.name).join(', ') || '—'}
					</p>

					{#if step.fields.length}
						<section class="card mb-6 grid gap-4 p-4">
							{#each step.fields as f (f.id)}
								{@const auto = isAuto(f.id) && !!f.defaultFrom && !!resolved[f.id]}
								<label class="block">
									<span class="label flex items-center gap-2">
										{f.label}
										{#if auto}<span class="rounded bg-green-100 px-1.5 text-[10px] font-semibold uppercase text-green-700">авто</span>{/if}
									</span>
									<div class="flex gap-1">
										{#if f.multiline}
											<textarea
												class="input min-h-24"
												bind:value={values[f.id]}
												placeholder={auto ? resolved[f.id] : `напр.: ${f.example}`}
											></textarea>
										{:else}
											<input
												class="input"
												bind:value={values[f.id]}
												placeholder={auto ? resolved[f.id] : `напр.: ${f.example}`}
											/>
										{/if}
										{#if auto}
											<button
												type="button"
												class="btn btn-sm"
												title="Скопіювати автоматичне значення для редагування"
												onclick={() => (values[f.id] = resolved[f.id])}>✎</button
											>
										{:else if f.defaultFrom && !isAuto(f.id)}
											<button
												type="button"
												class="btn btn-sm"
												title="Повернути автоматичне значення"
												onclick={() => (values[f.id] = '')}>↺</button
											>
										{/if}
									</div>
								</label>
							{/each}
						</section>
					{:else}
						<p class="card mb-6 p-4 text-sm text-slate-500">
							У цьому кроці нічого вводити не потрібно — усі дані беруться з попередніх кроків.
						</p>
					{/if}

					{#if inherited.length}
						<section class="mb-6">
							<h2 class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">З попередніх кроків</h2>
							<dl class="card divide-y divide-slate-100 text-sm">
								{#each inherited as o (o.field.id)}
									<div class="flex gap-3 px-4 py-2">
										<dt class="w-48 shrink-0 text-slate-500">{o.field.label}</dt>
										<dd class="min-w-0 flex-1 whitespace-pre-wrap font-serif">
											{#if resolved[o.field.id]}{resolved[o.field.id]}{:else}<span class="text-red-600">не заповнено</span>{/if}
										</dd>
										<button class="text-xs text-blue-700 hover:underline" onclick={() => (stepIndex = o.stepIndex)}>
											крок {o.stepIndex + 1}
										</button>
									</div>
								{/each}
							</dl>
						</section>
					{/if}

					<section class="card p-4">
						<h2 class="mb-3 text-sm font-semibold">Документи кроку</h2>
						{#if stepEmpty(stepIndex)}
							<p class="mb-3 text-sm text-amber-700">
								Порожніх полів: {stepEmpty(stepIndex)} — у документах вони будуть пропущені.
							</p>
						{/if}
						<ul class="mb-3 grid gap-2">
							{#each step.docs as d (d.id)}
								<li class="flex items-center gap-2 text-sm">
									<span class="min-w-0 flex-1 truncate">📄 {d.name}</span>
									<button
										class="btn btn-sm"
										disabled={downloading}
										onclick={() => download(`?step=${step.id}&doc=${d.id}`)}>⤓ .docx</button
									>
								</li>
							{/each}
						</ul>
						<div class="flex justify-between gap-2">
							<button class="btn" disabled={stepIndex === 0} onclick={() => stepIndex--}>← Назад</button>
							<div class="flex gap-2">
								{#if step.docs.length > 1}
									<button class="btn" disabled={downloading} onclick={() => download(`?step=${step.id}`)}>
										⤓ Усі документи кроку
									</button>
								{/if}
								<button class="btn btn-primary" disabled={stepIndex >= wf.steps.length - 1} onclick={() => stepIndex++}>
									Далі →
								</button>
							</div>
						</div>
					</section>
				</div>
			{/if}
		</main>
	</div>
</div>
