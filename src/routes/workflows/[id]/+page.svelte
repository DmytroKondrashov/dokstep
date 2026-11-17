<script lang="ts">
	import { beforeNavigate } from '$app/navigation';
	import { untrack } from 'svelte';
	import { api, debounce } from '#lib/api.js';
	import DocPreview, {
		type HighlightRange,
		type SelectionInfo
	} from '#lib/components/DocPreview.svelte';
	import MarkPopover from '#lib/components/MarkPopover.svelte';
	import TransformEditor from '#lib/components/TransformEditor.svelte';
	import TransformPreview from '#lib/components/TransformPreview.svelte';
	import {
		type TextRange,
		addMarks,
		availableFields,
		fieldLocation,
		findOccurrences,
		inheritedFields,
		overlapsMark,
		removeDoc,
		removeField,
		removeStep,
		uid
	} from '#lib/editor.js';
	import { describeTransform } from '#lib/transform.js';
	import type { DocPreview as Preview, Mark, StepDoc, Suggestion, Transform } from '#lib/types.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// The editor owns a copy of the definition and autosaves it.
	const wf = $state(
		untrack(() => ({
			name: data.workflow.name,
			description: data.workflow.description,
			steps: data.workflow.steps
		}))
	);
	let previews = $state.raw<Record<string, Preview>>(untrack(() => data.previews));
	const workflowId = untrack(() => data.workflow.id);

	let stepIndex = $state(0);
	let docId = $state<string | null>(null);
	const step = $derived(wf.steps[stepIndex]);
	const doc = $derived<StepDoc | undefined>(
		step?.docs.find((d) => d.id === docId) ?? step?.docs[0]
	);

	/* ---------- autosave ---------- */
	let saveState = $state<'saved' | 'dirty' | 'saving' | 'error'>('saved');
	const save = debounce(async () => {
		saveState = 'saving';
		try {
			await api(`/api/workflows/${workflowId}`, 'PUT', $state.snapshot(wf));
			saveState = save.pending() ? 'dirty' : 'saved';
		} catch {
			saveState = 'error';
		}
	}, 600);
	let loaded = false;
	$effect(() => {
		JSON.stringify(wf);
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

	/* ---------- suggestions ---------- */
	let suggestions = $state<Suggestion[]>([]);
	const loadSuggestions = debounce(async (steps: unknown, stepId: string) => {
		try {
			const s = await api<Suggestion[]>(`/api/workflows/${workflowId}/suggest`, 'POST', {
				steps,
				stepId
			});
			if (step?.id === stepId) suggestions = s;
		} catch {
			suggestions = [];
		}
	}, 700);
	$effect(() => {
		const snap = $state.snapshot(wf.steps);
		const id = step?.id;
		if (id) loadSuggestions(snap, id);
	});

	/* ---------- messages ---------- */
	let toast = $state('');
	let toastTimer: ReturnType<typeof setTimeout>;
	function say(msg: string) {
		toast = msg;
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (toast = ''), 3500);
	}

	/* ---------- steps ---------- */
	function selectStep(i: number) {
		stepIndex = i;
		docId = null;
		popover = null;
		activeField = null;
		suggestions = [];
	}
	function addStep() {
		wf.steps.push({
			id: uid(),
			name: `Крок ${wf.steps.length + 1}`,
			docs: [],
			fields: [],
			marks: []
		});
		selectStep(wf.steps.length - 1);
	}
	function moveStep(i: number, d: -1 | 1) {
		const j = i + d;
		if (j < 0 || j >= wf.steps.length) return;
		[wf.steps[i], wf.steps[j]] = [wf.steps[j], wf.steps[i]];
		if (stepIndex === i) stepIndex = j;
		else if (stepIndex === j) stepIndex = i;
	}
	function deleteStep(i: number) {
		const s = wf.steps[i];
		if (
			!confirm(
				`Видалити крок «${s.name}» з документами та полями? Поля цього кроку зникнуть і з наступних кроків.`
			)
		)
			return;
		removeStep(wf.steps, i);
		selectStep(Math.max(0, Math.min(stepIndex, wf.steps.length - 1)));
	}

	/* ---------- documents ---------- */
	let uploading = $state(false);
	let dragOver = $state(false);
	async function upload(files: FileList | File[] | null) {
		const list = [...(files ?? [])].filter((f) => f.name.toLowerCase().endsWith('.docx'));
		if (!list.length) return say('Підтримуються лише файли .docx');
		const fd = new FormData();
		for (const f of list) fd.append('files', f);
		uploading = true;
		try {
			const res = await api<{ id: string; name: string; preview: Preview }[]>(
				`/api/workflows/${workflowId}/documents`,
				'POST',
				fd
			);
			previews = { ...previews, ...Object.fromEntries(res.map((r) => [r.id, r.preview])) };
			for (const r of res) {
				step.docs.push({ id: r.id, name: r.name, outputName: r.name });
			}
			docId = res[res.length - 1]?.id ?? docId;
		} catch (e) {
			say((e as Error).message);
		} finally {
			uploading = false;
		}
	}
	function deleteDoc(d: StepDoc) {
		const n = step.marks.filter((m) => m.docId === d.id).length;
		if (!confirm(`Видалити документ «${d.name}»${n ? ` і ${n} позначок у ньому` : ''}?`)) return;
		removeDoc(step, d.id);
		docId = null;
	}

	/* ---------- marks ---------- */
	type Popover =
		| {
				kind: 'new';
				range: TextRange;
				text: string;
				rect: DOMRect;
				occurrences: TextRange[];
				fieldId?: string;
				transform?: Transform;
		  }
		| { kind: 'mark'; markId: string; rect: DOMRect };
	let popover = $state<Popover | null>(null);
	let activeField = $state<string | null>(null);
	const popMark = $derived.by(() => {
		const p = popover;
		return p?.kind === 'mark' ? step.marks.find((m) => m.id === p.markId) : undefined;
	});

	const ownIds = $derived(new Set(step?.fields.map((f) => f.id)));
	const labelOf = (id: string) => fieldLocation(wf.steps, id)?.field.label ?? '?';

	function withSelf(occ: TextRange[], r: TextRange) {
		const has = occ.some((o) => o.docId === r.docId && o.para === r.para && o.start === r.start);
		return has ? occ : [r, ...occ];
	}

	function onselect(s: SelectionInfo) {
		if (!doc) return;
		const range = { docId: doc.id, para: s.para, start: s.start, end: s.end };
		if (overlapsMark(step.marks, range)) return say('Фрагмент перетинається з наявною позначкою.');
		const occurrences = withSelf(findOccurrences(step, previews, s.text), range);
		popover = { kind: 'new', range, text: s.text, rect: s.rect, occurrences };
	}

	function onrangeclick(id: string, rect: DOMRect) {
		if (id.startsWith('hint:')) {
			const [, si, oi] = id.split(':').map(Number);
			const sg = suggestions[si];
			const o = sg?.occurrences[oi];
			if (!o) return;
			const occurrences = withSelf(findOccurrences(step, previews, sg.text), o);
			popover = {
				kind: 'new',
				range: o,
				text: sg.text,
				rect,
				occurrences,
				fieldId: sg.fieldId,
				transform: sg.transform
			};
		} else {
			popover = { kind: 'mark', markId: id, rect };
			activeField = null;
		}
	}

	function closePopover() {
		popover = null;
		window.getSelection()?.removeAllRanges();
	}

	function createField(
		f: { label: string; example: string; multiline: boolean; transform?: Transform },
		all: boolean
	) {
		if (popover?.kind !== 'new') return;
		const field = {
			id: uid(),
			label: f.label,
			example: f.example,
			...(f.multiline ? { multiline: true } : {})
		};
		step.fields.push(field);
		addMarks(step, all ? popover.occurrences : [popover.range], field.id, f.transform);
		closePopover();
	}

	function linkField(fieldId: string, transform: Transform | undefined, all: boolean) {
		if (popover?.kind !== 'new') return;
		addMarks(step, all ? popover.occurrences : [popover.range], fieldId, transform);
		closePopover();
	}

	function updateMark(patch: Partial<Mark>) {
		if (!popMark) return;
		if ('transform' in patch && !patch.transform) delete popMark.transform;
		else Object.assign(popMark, patch);
	}

	function deleteMark() {
		if (!popMark) return;
		step.marks = step.marks.filter((m) => m.id !== popMark.id);
		popover = null;
	}

	function applySuggestion(s: Suggestion) {
		addMarks(step, s.occurrences, s.fieldId, s.transform);
	}

	function focusField(fieldId: string) {
		activeField = activeField === fieldId ? null : fieldId;
		const m =
			step.marks.find((x) => x.fieldId === fieldId && x.docId === doc?.id) ??
			step.marks.find((x) => x.fieldId === fieldId);
		if (activeField && m) {
			docId = m.docId;
			requestAnimationFrame(() =>
				document
					.querySelector(`[data-range="${m.id}"]`)
					?.scrollIntoView({ behavior: 'smooth', block: 'center' })
			);
		}
	}

	function deleteField(fieldId: string) {
		const usedLater = wf.steps
			.slice(stepIndex + 1)
			.some((s) => s.marks.some((m) => m.fieldId === fieldId));
		const msg = usedLater
			? `Поле «${labelOf(fieldId)}» використовується в наступних кроках. Видалити разом з усіма позначками?`
			: `Видалити поле «${labelOf(fieldId)}» і його позначки?`;
		if (!confirm(msg)) return;
		removeField(wf.steps, fieldId);
		if (activeField === fieldId) activeField = null;
	}

	/* ---------- derived view data ---------- */
	const ranges = $derived.by(() => {
		const out: Record<string, HighlightRange[]> = {};
		if (!doc) return out;
		const push = (para: string, r: HighlightRange) => {
			out[para] ??= [];
			out[para].push(r);
		};
		for (const m of step.marks) {
			if (m.docId !== doc.id) continue;
			const t = describeTransform(m.transform);
			push(m.para, {
				id: m.id,
				start: m.start,
				end: m.end,
				kind: ownIds.has(m.fieldId) ? 'own' : 'inherited',
				title: `${labelOf(m.fieldId)}${t ? ` (${t})` : ''}`
			});
		}
		for (const [si, s] of suggestions.entries())
			for (const [oi, o] of s.occurrences.entries())
				if (o.docId === doc.id)
					push(o.para, {
						id: `hint:${si}:${oi}`,
						start: o.start,
						end: o.end,
						kind: 'hint',
						title: `Підказка: ${labelOf(s.fieldId)}`
					});
		return out;
	});

	const active = $derived.by(() => {
		const ids = new Set<string>();
		if (popMark) ids.add(popMark.id);
		if (activeField) for (const m of step.marks) if (m.fieldId === activeField) ids.add(m.id);
		return ids;
	});

	const markCount = (fieldId: string) => step.marks.filter((m) => m.fieldId === fieldId).length;
	const inherited = $derived(step ? inheritedFields(wf.steps, stepIndex) : []);
	/** Defaults may come from earlier steps' fields or this step's earlier fields. */
	const defaultOptions = (fieldId: string) =>
		availableFields(wf.steps, stepIndex).filter((o) => {
			if (o.stepIndex < stepIndex) return true;
			const own = step.fields.map((f) => f.id);
			return own.indexOf(o.field.id) < own.indexOf(fieldId);
		});

	let runForm: HTMLFormElement;
	async function startRun() {
		await save.flush();
		runForm.submit();
	}
</script>

<svelte:window
	onbeforeunload={(e) => {
		if (saveState !== 'saved') {
			save.flush();
			e.preventDefault();
		}
	}}
/>

<div class="flex h-[calc(100vh-3rem)] flex-col">
	<!-- toolbar -->
	<div class="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2">
		<a href="/" class="btn btn-sm">← Процеси</a>
		<input class="input max-w-md font-semibold" bind:value={wf.name} aria-label="Назва процесу" />
		<span class="text-xs text-slate-500">
			{#if saveState === 'saved'}Збережено{:else if saveState === 'error'}<span class="text-red-600">Помилка збереження</span>{:else}Збереження…{/if}
		</span>
		<div class="ml-auto flex items-center gap-2">
			{#if data.runs.length}
				<details class="relative">
					<summary class="btn btn-sm cursor-pointer list-none">Справи ({data.runs.length})</summary>
					<ul class="card absolute right-0 z-40 mt-1 max-h-80 w-72 overflow-auto p-1">
						{#each data.runs as r (r.id)}
							<li><a class="block truncate rounded px-2 py-1 text-sm hover:bg-slate-100" href="/runs/{r.id}">{r.name}</a></li>
						{/each}
					</ul>
				</details>
			{/if}
			<form bind:this={runForm} method="POST" action="/?/createRun">
				<input type="hidden" name="workflowId" value={workflowId} />
				<button type="button" class="btn btn-primary" onclick={startRun}>Сформувати документи →</button>
			</form>
		</div>
	</div>

	<div class="grid min-h-0 flex-1 grid-cols-[14rem_1fr_22rem]">
		<!-- steps -->
		<nav class="overflow-auto border-r border-slate-200 bg-white p-3">
			<h2 class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Кроки</h2>
			<ol class="grid gap-1">
				{#each wf.steps as s, i (s.id)}
					<li>
						<div
							class="group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm {i === stepIndex
								? 'bg-blue-50 text-blue-800'
								: 'hover:bg-slate-100'}"
						>
							<button class="min-w-0 flex-1 truncate text-left" onclick={() => selectStep(i)}>
								<span class="text-slate-400">{i + 1}.</span>
								{s.name}
								<span class="block text-xs text-slate-400">док.: {s.docs.length} · полів: {s.fields.length}</span>
							</button>
							<span class="hidden flex-col group-hover:flex">
								<button class="text-xs leading-none text-slate-400 hover:text-slate-900" title="Вище" onclick={() => moveStep(i, -1)}>▲</button>
								<button class="text-xs leading-none text-slate-400 hover:text-slate-900" title="Нижче" onclick={() => moveStep(i, 1)}>▼</button>
							</span>
						</div>
					</li>
				{/each}
			</ol>
			<button class="btn btn-sm mt-2 w-full justify-center" onclick={addStep}>+ Додати крок</button>
		</nav>

		<!-- documents -->
		<section class="flex min-w-0 flex-col overflow-hidden">
			{#if step}
				<div class="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2">
					<input class="input max-w-xs" bind:value={step.name} aria-label="Назва кроку" />
					<button class="btn btn-sm btn-danger" onclick={() => deleteStep(stepIndex)} disabled={wf.steps.length < 2}>
						Видалити крок
					</button>
					<div class="ml-auto flex items-center gap-3 text-xs text-slate-600">
						<span><span class="inline-block h-3 w-3 rounded-sm bg-amber-200 align-middle"></span> поле кроку</span>
						<span><span class="inline-block h-3 w-3 rounded-sm bg-green-200 align-middle"></span> з попереднього кроку</span>
						<span><span class="inline-block w-4 border-b-2 border-dashed border-violet-600 align-middle"></span> підказка</span>
					</div>
				</div>

				<div class="flex items-center gap-1 overflow-x-auto border-b border-slate-200 bg-slate-100 px-2 pt-2">
					{#each step.docs as d (d.id)}
						<button
							class="max-w-56 shrink-0 truncate rounded-t-md border border-b-0 px-3 py-1.5 text-sm {d.id === doc?.id
								? 'border-slate-200 bg-white font-medium'
								: 'border-transparent text-slate-600 hover:bg-slate-200'}"
							onclick={() => (docId = d.id)}
							title={d.name}
						>
							{d.name}
						</button>
					{/each}
					<label class="btn btn-sm mb-1 ml-1 shrink-0 cursor-pointer">
						{uploading ? 'Завантаження…' : '+ Документ (.docx)'}
						<input
							type="file"
							accept=".docx"
							multiple
							class="hidden"
							onchange={(e) => {
								upload(e.currentTarget.files);
								e.currentTarget.value = '';
							}}
						/>
					</label>
				</div>

				{#if doc && previews[doc.id]}
					<div class="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2 text-sm">
						<label class="flex flex-1 items-center gap-2">
							<span class="shrink-0 text-xs text-slate-500">Назва файлу результату</span>
							<input
								class="input"
								bind:value={doc.outputName}
								title="Можна вставляти значення полів: {'{'}Назва поля{'}'}"
								placeholder="напр. Наказ {'{'}ПІБ{'}'}"
							/>
						</label>
						<a class="btn btn-sm" href="/api/documents/{doc.id}" download>⤓ Зразок</a>
						<button class="btn btn-sm btn-danger" onclick={() => deleteDoc(doc)}>Видалити документ</button>
					</div>
					<div class="min-h-0 flex-1 overflow-auto bg-slate-100 p-6">
						<p class="mx-auto mb-3 max-w-3xl text-center text-xs text-slate-500">
							Виділіть мишею фрагмент, який змінюватиметься: створіть з нього поле або візьміть значення з поля
							попереднього кроку. Клік по позначці — змінити її.
						</p>
						<DocPreview
							preview={previews[doc.id]}
							{ranges}
							{active}
							{onselect}
							{onrangeclick}
							onerror={say}
						/>
					</div>
				{:else}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="m-6 flex flex-1 flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 text-center {dragOver
							? 'border-blue-500 bg-blue-50'
							: 'border-slate-300'}"
						ondragover={(e) => {
							e.preventDefault();
							dragOver = true;
						}}
						ondragleave={() => (dragOver = false)}
						ondrop={(e) => {
							e.preventDefault();
							dragOver = false;
							upload(e.dataTransfer?.files ?? null);
						}}
					>
						<p class="mb-2 text-lg font-medium">Завантажте зразки документів цього кроку</p>
						<p class="mb-4 max-w-md text-sm text-slate-500">
							Перетягніть сюди один або кілька заповнених документів .docx. Потім позначте в них частини,
							що змінюються.
						</p>
						<label class="btn btn-primary cursor-pointer">
							Обрати файли
							<input type="file" accept=".docx" multiple class="hidden" onchange={(e) => upload(e.currentTarget.files)} />
						</label>
					</div>
				{/if}
			{/if}
		</section>

		<!-- fields -->
		<aside class="overflow-auto border-l border-slate-200 bg-white p-3">
			{#if step}
				<h2 class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
					Поля кроку ({step.fields.length})
				</h2>
				{#if !step.fields.length}
					<p class="mb-4 text-sm text-slate-500">Виділіть текст у документі, щоб створити поле.</p>
				{/if}
				<ul class="mb-6 grid gap-2">
					{#each step.fields as f (f.id)}
						{@const opts = defaultOptions(f.id)}
						<li class="rounded-md border p-2 {activeField === f.id ? 'border-blue-500' : 'border-slate-200'}">
							<div class="flex items-center gap-1">
								<span class="h-3 w-3 shrink-0 rounded-sm bg-amber-200"></span>
								<input class="input py-1" bind:value={f.label} />
								<button class="btn btn-sm" title="Показати в документі" onclick={() => focusField(f.id)}>
									{markCount(f.id)}
								</button>
								<button class="btn btn-sm btn-danger" title="Видалити поле" onclick={() => deleteField(f.id)}>✕</button>
							</div>
							<p class="mt-1 truncate text-xs text-slate-500" title={f.example}>Зразок: «{f.example}»</p>
							<div class="mt-1 flex items-center gap-3 text-xs">
								<label class="flex items-center gap-1">
									<input
										type="checkbox"
										checked={!!f.multiline}
										onchange={(e) => (f.multiline = e.currentTarget.checked)}
									/> багаторядкове
								</label>
							</div>
							{#if opts.length}
								<details class="mt-1 text-xs" open={!!f.defaultFrom}>
									<summary class="cursor-pointer text-slate-600">
										Автозаповнення {f.defaultFrom ? `з «${labelOf(f.defaultFrom.fieldId)}»` : '— вимкнено'}
									</summary>
									<div class="mt-2 grid gap-2">
										<select
											class="input"
											value={f.defaultFrom?.fieldId ?? ''}
											onchange={(e) => {
												const v = e.currentTarget.value;
												f.defaultFrom = v ? { fieldId: v, transform: f.defaultFrom?.transform } : null;
											}}
										>
											<option value="">— не заповнювати автоматично —</option>
											{#each opts as o (o.field.id)}
												<option value={o.field.id}>
													{o.stepIndex === stepIndex ? '' : `Крок ${o.stepIndex + 1} · `}{o.field.label}
												</option>
											{/each}
										</select>
										{#if f.defaultFrom}
											{@const src = fieldLocation(wf.steps, f.defaultFrom.fieldId)}
											<TransformEditor
												value={f.defaultFrom.transform}
												onchange={(t) => {
													if (f.defaultFrom) f.defaultFrom = { fieldId: f.defaultFrom.fieldId, ...(t ? { transform: t } : {}) };
												}}
											/>
											{#if src}
												<p class="text-slate-500">
													Приклад: <TransformPreview value={src.field.example} transform={f.defaultFrom.transform} />
												</p>
											{/if}
											<p class="text-slate-500">Якщо поле лишити порожнім, значення візьметься звідси.</p>
										{/if}
									</div>
								</details>
							{/if}
						</li>
					{/each}
				</ul>

				{#if inherited.length}
					<h2 class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">З попередніх кроків</h2>
					<ul class="mb-6 grid gap-1">
						{#each inherited as o (o.field.id)}
							<li class="flex items-center gap-2 text-sm">
								<span class="h-3 w-3 shrink-0 rounded-sm bg-green-200"></span>
								<button class="min-w-0 flex-1 truncate text-left hover:underline" onclick={() => focusField(o.field.id)}>
									{o.field.label}
								</button>
								<span class="text-xs text-slate-400">крок {o.stepIndex + 1} · ×{o.count}</span>
							</li>
						{/each}
					</ul>
				{/if}

				{#if suggestions.length}
					<h2 class="mb-1 text-xs font-semibold uppercase tracking-wide text-violet-700">Підказки</h2>
					<p class="mb-2 text-xs text-slate-500">
						Значення полів знайдено в документах кроку (з урахуванням відмінків і форматів).
					</p>
					<ul class="mb-2 grid gap-1">
						{#each suggestions as s (s.fieldId + JSON.stringify(s.transform ?? {}))}
							{@const t = describeTransform(s.transform)}
							<li class="rounded-md border border-violet-200 bg-violet-50 p-2 text-xs">
								<div class="font-serif text-sm">«{s.text}»</div>
								<div class="flex items-center gap-2">
									<span class="min-w-0 flex-1 text-slate-600">
										→ {labelOf(s.fieldId)}{t ? ` · ${t}` : ''} · ×{s.occurrences.length}
									</span>
									<button class="btn btn-sm" onclick={() => applySuggestion(s)}>Позначити</button>
								</div>
							</li>
						{/each}
					</ul>
					<button
						class="btn btn-sm w-full justify-center"
						onclick={() => {
							for (const s of suggestions) applySuggestion(s);
						}}
					>
						Позначити всі підказки
					</button>
				{/if}
			{/if}
		</aside>
	</div>
</div>

{#if popover && step}
	{#key popover.kind === 'mark' ? popover.markId : `${popover.range.para}:${popover.range.start}`}
		<MarkPopover
			mode={popover.kind === 'mark' && popMark
				? { kind: 'mark', mark: popMark, rect: popover.rect }
				: popover.kind === 'new'
					? {
							kind: 'new',
							text: popover.text,
							rect: popover.rect,
							occurrences: popover.occurrences.length,
							fieldId: popover.fieldId,
							transform: popover.transform
						}
					: { kind: 'new', text: '', rect: popover.rect, occurrences: 0 }}
			steps={wf.steps}
			{stepIndex}
			oncreate={createField}
			onlink={linkField}
			onupdate={updateMark}
			ondelete={deleteMark}
			onclose={closePopover}
		/>
	{/key}
{/if}

{#if toast}
	<div class="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md bg-slate-900 px-4 py-2 text-sm text-white shadow-lg">
		{toast}
	</div>
{/if}
