<script lang="ts">
	import { enhance } from '$app/forms';
	import AppHeader from '#lib/components/AppHeader.svelte';
	import DocThumb from '#lib/components/DocThumb.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let creating = $state(false);
	let query = $state('');

	const q = $derived(query.trim().toLowerCase());
	const workflows = $derived(data.workflows.filter((w) => !q || w.name.toLowerCase().includes(q)));
	const runs = $derived(
		data.runs.filter((r) => !q || `${r.name} ${r.workflowName}`.toLowerCase().includes(q))
	);

	const fmt = (iso: string) =>
		new Date(iso).toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' });
	const plural = (n: number, one: string, few: string, many: string) => {
		const m10 = n % 10;
		const m100 = n % 100;
		const w =
			m10 === 1 && m100 !== 11
				? one
				: m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)
					? few
					: many;
		return `${n} ${w}`;
	};
	const confirmDelete = (what: string) => (e: SubmitEvent) => {
		if (!confirm(`Видалити ${what}? Цю дію не можна скасувати.`)) e.preventDefault();
	};
</script>

<AppHeader>
	{#snippet actions()}
		<label class="relative flex w-80 max-w-full items-center">
			<span class="sr-only">Пошук процесів і справ</span>
			<Icon name="search" size={18} class="absolute left-3 text-muted" />
			<input
				type="search"
				bind:value={query}
				placeholder="Пошук процесів і справ"
				class="input h-10 bg-sunken pl-10 text-sm"
			/>
		</label>
	{/snippet}
</AppHeader>

<main class="mx-auto max-w-7xl px-6 pt-10 pb-16">
	<div class="mb-7 flex flex-wrap items-end justify-between gap-6">
		<div class="max-w-2xl">
			<h1 class="mb-2 text-[34px] leading-tight font-bold tracking-tight">Процеси</h1>
			<p class="text-base text-muted">
				Процес — це послідовність кроків. На кожному кроці лежать зразки документів, у яких позначено те,
				що змінюється. Далі ви лише вводите дані.
			</p>
		</div>
		<div class="flex flex-wrap gap-2.5">
			<form method="POST" action="?/createDemo">
				<button class="btn">Відкрити приклад</button>
			</form>
			<button class="btn btn-primary" onclick={() => (creating = true)}>
				<Icon name="plus" size={18} stroke={2.2} /> Новий процес
			</button>
		</div>
	</div>

	{#if creating}
		<form method="POST" action="?/createWorkflow" use:enhance class="card mb-6 flex flex-wrap items-end gap-3 p-5">
			<label class="min-w-64 flex-1">
				<span class="label">Назва процесу</span>
				<!-- svelte-ignore a11y_autofocus -->
				<input name="name" class="input" placeholder="напр. «Оренда квартири»" autofocus />
			</label>
			<button class="btn btn-primary">Створити</button>
			<button type="button" class="btn btn-ghost" onclick={() => (creating = false)}>Скасувати</button>
			{#if form?.error}<p class="w-full text-sm text-danger">{form.error}</p>{/if}
		</form>
	{/if}

	<div class="mb-12 grid grid-cols-[repeat(auto-fill,minmax(360px,1fr))] gap-5">
		{#each workflows as wf (wf.id)}
			<article class="card flex flex-col gap-4 p-5">
				<div class="flex items-start gap-1.5 overflow-x-auto rounded-xl bg-sunken p-4">
					{#each wf.steps as s, i (i)}
						{#if i}
							<Icon name="arrow" size={18} class="mt-7 text-faint" />
						{/if}
						<div class="flex flex-col items-center gap-1.5">
							<DocThumb bars={s.bars} />
							<span class="max-w-20 truncate text-xs text-muted" title={s.name}>{s.name}</span>
						</div>
					{:else}
						<p class="text-sm text-muted">Кроків ще немає</p>
					{/each}
				</div>
				<div>
					<h2 class="mb-1 text-[19px] font-semibold tracking-tight">
						<a href="/workflows/{wf.id}" class="text-ink no-underline hover:underline">{wf.name}</a>
					</h2>
					<p class="text-sm text-muted">
						{plural(wf.steps.length, 'крок', 'кроки', 'кроків')} · {plural(wf.docs, 'документ', 'документи', 'документів')}
						· {plural(wf.fields, 'поле', 'поля', 'полів')}
					</p>
				</div>
				<div class="mt-auto flex flex-wrap items-center gap-2 border-t border-line-soft pt-3.5">
					<span class="flex-1 text-[13px] text-muted">
						{wf.runs ? `Справ: ${wf.runs}` : 'Справ ще немає'}
					</span>
					<form method="POST" action="?/deleteWorkflow" use:enhance onsubmit={confirmDelete(`процес «${wf.name}» разом з усіма справами`)}>
						<input type="hidden" name="id" value={wf.id} />
						<button class="btn btn-ghost btn-icon btn-sm" aria-label="Видалити процес «{wf.name}»">
							<Icon name="trash" />
						</button>
					</form>
					<a href="/workflows/{wf.id}" class="btn btn-sm h-10 no-underline">Редагувати</a>
					<form method="POST" action="?/createRun">
						<input type="hidden" name="workflowId" value={wf.id} />
						<button class="btn btn-primary btn-sm h-10" disabled={!wf.docs}>Сформувати</button>
					</form>
				</div>
			</article>
		{/each}

		<button
			class="flex min-h-72 cursor-pointer flex-col items-center justify-center gap-2.5 rounded-2xl border-[1.5px] border-dashed border-[#b8c0cc] p-6 text-muted hover:border-accent hover:bg-surface/60"
			onclick={() => (creating = true)}
		>
			<span class="flex h-12 w-12 items-center justify-center rounded-xl border border-line bg-surface text-ink">
				<Icon name="plus" size={22} />
			</span>
			<span class="text-base font-semibold text-ink">Новий процес</span>
			<span class="max-w-64 text-center text-sm">
				Завантажте заповнені зразки .docx — і позначте, що в них змінюється
			</span>
		</button>
	</div>

	<section aria-labelledby="cases-title" id="cases">
		<h2 id="cases-title" class="mb-3.5 text-[22px] font-bold tracking-tight">Останні справи</h2>
		{#if !runs.length}
			<p class="card p-6 text-sm text-muted">
				Справа — це один набір заповнених документів за процесом. Натисніть «Сформувати» на картці процесу.
			</p>
		{:else}
			<div class="card overflow-x-auto">
				<table class="w-full min-w-[760px] border-collapse text-sm">
					<thead>
						<tr class="text-left text-[13px] text-muted">
							<th scope="col" class="border-b border-line-soft px-5 py-3.5 font-semibold">Справа</th>
							<th scope="col" class="border-b border-line-soft px-5 py-3.5 font-semibold">Процес</th>
							<th scope="col" class="border-b border-line-soft px-5 py-3.5 font-semibold">Готовність</th>
							<th scope="col" class="border-b border-line-soft px-5 py-3.5 font-semibold">Змінено</th>
							<th scope="col" class="border-b border-line-soft px-5 py-3.5"><span class="sr-only">Дії</span></th>
						</tr>
					</thead>
					<tbody>
						{#each runs as r (r.id)}
							{@const done = r.stepsDone >= r.stepsTotal}
							<tr class="border-b border-line-soft last:border-0">
								<td class="px-5 py-4">
									<a href="/runs/{r.id}" class="font-semibold text-ink no-underline hover:underline">{r.name}</a>
								</td>
								<td class="px-5 py-4 text-muted">{r.workflowName}</td>
								<td class="px-5 py-4">
									<div class="flex items-center gap-2.5">
										<div class="flex gap-1" aria-hidden="true">
											{#each { length: r.stepsTotal }, i (i)}
												<span
													class="h-1.5 w-[22px] rounded-full {i < r.stepsDone ? 'bg-inh-line' : i === r.stepsDone ? 'bg-accent' : 'bg-line'}"
												></span>
											{/each}
										</div>
										{#if done}
											<span class="font-semibold text-inh-ink">готово</span>
										{:else}
											<span class="text-muted">крок {r.stepsDone + 1} з {r.stepsTotal}</span>
										{/if}
									</div>
								</td>
								<td class="px-5 py-4 text-muted">{fmt(r.updatedAt)}</td>
								<td class="px-5 py-4">
									<div class="flex items-center justify-end gap-3">
										<a href="/runs/{r.id}" class="font-semibold text-accent">{done ? 'Відкрити' : 'Продовжити'}</a>
										<form method="POST" action="?/deleteRun" use:enhance onsubmit={confirmDelete(`справу «${r.name}»`)}>
											<input type="hidden" name="id" value={r.id} />
											<button class="btn btn-ghost btn-icon btn-sm" aria-label="Видалити справу «{r.name}»">
												<Icon name="trash" />
											</button>
										</form>
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>
</main>
