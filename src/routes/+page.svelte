<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const fmt = (iso: string) =>
		new Date(iso).toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' });
	const confirmDelete = (what: string) => (e: SubmitEvent) => {
		if (!confirm(`Видалити ${what}? Цю дію не можна скасувати.`)) e.preventDefault();
	};
</script>

<main class="mx-auto grid max-w-6xl gap-8 p-6 lg:grid-cols-[2fr_1fr]">
	<section>
		<h1 class="mb-4 text-2xl font-semibold">Процеси</h1>

		<form method="POST" action="?/createWorkflow" use:enhance class="card mb-6 flex gap-2 p-4">
			<input name="name" class="input" placeholder="Назва нового процесу, напр. «Оренда квартири»" />
			<button class="btn btn-primary shrink-0">+ Створити</button>
		</form>
		{#if form?.error}<p class="mb-4 text-sm text-red-600">{form.error}</p>{/if}

		{#if !data.workflows.length}
			<div class="card p-8 text-center text-slate-500">
				<p class="mb-2 text-lg">Ще немає жодного процесу.</p>
				<p class="text-sm">
					Створіть процес, додайте кроки, завантажте до кожного кроку зразки документів (.docx) і
					позначте в них змінні частини. Потім формуйте нові документи, заповнюючи лише ці поля.
				</p>
				<form method="POST" action="?/createDemo" class="mt-4">
					<button class="btn btn-primary">Відкрити приклад: «Прийняття на роботу»</button>
				</form>
			</div>
		{/if}

		<ul class="grid gap-3">
			{#each data.workflows as wf (wf.id)}
				<li class="card flex items-center gap-4 p-4">
					<div class="min-w-0 flex-1">
						<a href="/workflows/{wf.id}" class="font-medium hover:underline">{wf.name}</a>
						<p class="text-xs text-slate-500">
							кроків: {wf.steps} · документів: {wf.docs} · змінено {fmt(wf.updatedAt)}
						</p>
					</div>
					<form method="POST" action="?/createRun">
						<input type="hidden" name="workflowId" value={wf.id} />
						<button class="btn btn-primary" disabled={!wf.docs}>Сформувати документи</button>
					</form>
					<a href="/workflows/{wf.id}" class="btn">Редагувати</a>
					<form method="POST" action="?/deleteWorkflow" use:enhance onsubmit={confirmDelete(`процес «${wf.name}» разом з усіма справами`)}>
						<input type="hidden" name="id" value={wf.id} />
						<button class="btn btn-danger" title="Видалити">✕</button>
					</form>
				</li>
			{/each}
		</ul>
		{#if data.workflows.length}
			<form method="POST" action="?/createDemo" class="mt-4">
				<button class="text-sm text-blue-700 hover:underline">+ Додати приклад «Прийняття на роботу»</button>
			</form>
		{/if}
	</section>

	<aside>
		<h2 class="mb-4 text-lg font-semibold">Справи</h2>
		{#if !data.runs.length}
			<p class="text-sm text-slate-500">Справа — це один набір заповнених документів за процесом.</p>
		{/if}
		<ul class="grid gap-2">
			{#each data.runs as run (run.id)}
				<li class="card flex items-center gap-2 p-3">
					<div class="min-w-0 flex-1">
						<a href="/runs/{run.id}" class="block truncate text-sm font-medium hover:underline">{run.name}</a>
						<p class="truncate text-xs text-slate-500">{run.workflowName} · {fmt(run.updatedAt)}</p>
					</div>
					<form method="POST" action="?/deleteRun" use:enhance onsubmit={confirmDelete(`справу «${run.name}»`)}>
						<input type="hidden" name="id" value={run.id} />
						<button class="btn btn-sm btn-danger" title="Видалити">✕</button>
					</form>
				</li>
			{/each}
		</ul>
	</aside>
</main>
