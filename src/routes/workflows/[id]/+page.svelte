<script lang="ts">
	import { beforeNavigate } from '$app/navigation';
	import { onMount, untrack } from 'svelte';
	import { Autosave, guardPage } from '#lib/autosave.svelte.js';
	import { api, debounce } from '#lib/api.js';
	import AppHeader from '#lib/components/AppHeader.svelte';
	import DocPreview, {
		type HighlightRange,
		type MarginNote,
		type SelectionInfo
	} from '#lib/components/DocPreview.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import SaveStatus from '#lib/components/SaveStatus.svelte';
	import MarkPopover from '#lib/components/MarkPopover.svelte';
	import TransformEditor from '#lib/components/TransformEditor.svelte';
	import TransformPreview from '#lib/components/TransformPreview.svelte';
	import {
		type TextRange,
		addMarks,
		dropMissingDocs,
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
	import type {
		DocFormat,
		DocPreview as Preview,
		Mark,
		Step,
		StepDoc,
		Suggestion,
		Transform
	} from '#lib/types.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	type Def = { name: string; description: string; steps: Step[] };

	// The editor owns a copy of the definition. Every change is kept in the browser at once
	// and saved to the server in the background (see Autosave).
	const save = new Autosave<Def>({
		key: `dokstep:workflow:${untrack(() => data.workflow.id)}`,
		base: untrack(() => data.workflow.updatedAt),
		delay: 600,
		send: async (def, o) =>
			(
				await api<{ updatedAt: string }>(
					`/api/workflows/${untrack(() => data.workflow.id)}`,
					'PUT',
					{ ...def, rev: o.rev },
					{ keepalive: o.keepalive }
				)
			).updatedAt
	});
	/** Edits from this browser the server never got (closed tab, server down) come back. */
	const draft = save.restore();
	const wf = $state<Def>(
		untrack(() =>
			draft
				? dropMissingDocs(draft, data.previews)
				: {
						name: data.workflow.name,
						description: data.workflow.description,
						steps: data.workflow.steps
					}
		)
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
	let loaded = false;
	$effect(() => {
		const snap = $state.snapshot(wf);
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
	onMount(() => {
		if (draft) say('Відновлено зміни, які не встигли зберегтися на сервері.');
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
		const list = [...(files ?? [])].filter((f) => /\.(docx|txt)$/i.test(f.name));
		if (!list.length) return say('Підтримуються файли .docx і .txt');
		const fd = new FormData();
		for (const f of list) fd.append('files', f);
		uploading = true;
		try {
			const res = await api<{ id: string; name: string; format: DocFormat; preview: Preview }[]>(
				`/api/workflows/${workflowId}/documents`,
				'POST',
				fd
			);
			previews = { ...previews, ...Object.fromEntries(res.map((r) => [r.id, r.preview])) };
			for (const r of res) {
				step.docs.push({ id: r.id, name: r.name, format: r.format, outputName: r.name });
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

	/** Margin notes: one per mark (and suggestion) in the open document, by paragraph. */
	const notes = $derived.by(() => {
		const out: Record<string, MarginNote[]> = {};
		if (!doc) return out;
		const push = (para: string, n: MarginNote) => {
			out[para] ??= [];
			out[para].push(n);
		};
		const sorted = step.marks.filter((m) => m.docId === doc.id).sort((a, b) => a.start - b.start);
		for (const m of sorted) {
			const own = ownIds.has(m.fieldId);
			const f = fieldLocation(wf.steps, m.fieldId)?.field;
			const detail = [own && f?.defaultFrom ? 'авто' : '', describeTransform(m.transform)]
				.filter(Boolean)
				.join(' · ');
			push(m.para, {
				id: m.id,
				kind: own ? 'own' : 'inherited',
				label: labelOf(m.fieldId),
				detail
			});
		}
		for (const [si, s] of suggestions.entries())
			for (const [oi, o] of s.occurrences.entries())
				if (o.docId === doc.id)
					push(o.para, { id: `hint:${si}:${oi}`, kind: 'hint', label: labelOf(s.fieldId) });
		return out;
	});

	const markText = (m: Mark) => previews[m.docId]?.text[m.para]?.slice(m.start, m.end) ?? '';

	let expandedField = $state<string | null>(null);
	const ownCount = (i: number) => wf.steps[i].fields.length;
	const inheritedCount = (i: number) => inheritedFields(wf.steps, i).length;
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

	/** File-name pattern split into text and `{Field}` tokens, for the pill view. */
	const nameParts = $derived(
		(doc?.outputName ?? '')
			.split(/(\{[^{}]+\})/)
			.filter(Boolean)
			.map((t) => {
				const m = t.match(/^\{(.+)\}$/);
				if (!m) return { text: t };
				const f = wf.steps.flatMap((s) => s.fields).find((x) => x.label === m[1].trim());
				return { text: m[1], kind: f ? (ownIds.has(f.id) ? 'own' : 'inh') : 'missing' };
			})
	);
	let editingName = $state(false);

	let runForm: HTMLFormElement;
	async function startRun() {
		await save.flush();
		runForm.submit();
	}
</script>

<AppHeader crumbs={[{ href: '/', label: 'Процеси' }]}>
	{#snippet title()}
		<input
			class="h-9 w-[min(28rem,60vw)] rounded-lg border border-transparent bg-transparent px-2 text-[17px] font-semibold hover:border-line focus:border-accent focus:bg-surface"
			bind:value={wf.name}
			aria-label="Назва процесу"
		/>
	{/snippet}
	{#snippet actions()}
		<SaveStatus state={save.state} />
		{#if data.runs.length}
			<details class="relative">
				<summary class="btn btn-sm list-none">Справи · {data.runs.length}</summary>
				<ul class="card absolute right-0 z-40 mt-1 max-h-80 w-72 overflow-auto p-1 shadow-lg">
					{#each data.runs as r (r.id)}
						<li>
							<a class="block truncate rounded-lg px-3 py-2 text-sm text-ink no-underline hover:bg-ground" href="/runs/{r.id}">{r.name}</a>
						</li>
					{/each}
				</ul>
			</details>
		{/if}
		<form bind:this={runForm} method="POST" action="/?/createRun">
			<input type="hidden" name="workflowId" value={workflowId} />
			<button type="button" class="btn btn-primary" onclick={startRun}>
				Сформувати документи <Icon name="arrow" size={18} stroke={2.2} />
			</button>
		</form>
	{/snippet}
</AppHeader>

<section aria-label="Кроки процесу" class="border-b border-line bg-surface">
	<ol class="flex items-stretch gap-2.5 overflow-x-auto px-6 py-3.5">
		{#each wf.steps as s, i (s.id)}
			<li class="flex items-center gap-2.5">
				<button
					class="flex min-w-56 cursor-pointer items-center gap-3 rounded-xl py-2.5 pr-4 pl-2.5 text-left {i === stepIndex
						? 'border-2 border-accent bg-[#f5f7ff]'
						: 'border border-line hover:bg-sunken'}"
					aria-current={i === stepIndex ? 'step' : undefined}
					onclick={() => selectStep(i)}
				>
					<span
						class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold {i === stepIndex
							? 'bg-accent text-white'
							: 'bg-ground'}">{i + 1}</span
					>
					<span class="flex min-w-0 flex-col leading-tight">
						<span class="max-w-48 truncate text-sm font-semibold">{s.name}</span>
						<span class="text-[13px] text-muted">
							{plural(s.docs.length, 'документ', 'документи', 'документів')} · {plural(ownCount(i), 'поле', 'поля', 'полів')}{#if i > 0 && inheritedCount(i)}&nbsp;· +{inheritedCount(i)} з попер.{/if}
						</span>
					</span>
				</button>
				{#if i < wf.steps.length - 1}<Icon name="chevron" size={18} class="text-faint" />{/if}
			</li>
		{/each}
		<li class="ml-1 flex items-center">
			<button class="btn h-[54px] rounded-xl border-[1.5px] border-dashed border-[#b8c0cc] bg-transparent text-muted" onclick={addStep}>
				<Icon name="plus" /> Крок
			</button>
		</li>
	</ol>
</section>

{#if step}
	<div class="flex flex-wrap items-start gap-6 px-6 pt-5 pb-12">
		<section aria-label="Документ кроку" class="min-w-0 flex-[999_1_720px]">
			<div class="mb-4 flex flex-wrap items-center gap-2">
				<span class="text-[13px] font-semibold text-muted">Крок {stepIndex + 1}</span>
				<input class="input h-10 max-w-sm flex-1 font-semibold" bind:value={step.name} aria-label="Назва кроку" />
				<button class="btn btn-sm btn-icon" aria-label="Перемістити крок раніше" disabled={stepIndex === 0} onclick={() => moveStep(stepIndex, -1)}>
					<Icon name="chevron-left" />
				</button>
				<button class="btn btn-sm btn-icon" aria-label="Перемістити крок пізніше" disabled={stepIndex === wf.steps.length - 1} onclick={() => moveStep(stepIndex, 1)}>
					<Icon name="chevron" />
				</button>
				<button class="btn btn-sm btn-danger" disabled={wf.steps.length < 2} onclick={() => deleteStep(stepIndex)}>
					<Icon name="trash" /> Видалити крок
				</button>
			</div>

			<div class="mb-3.5 flex flex-wrap items-center gap-3">
				<div class="segmented" role="tablist" aria-label="Документи кроку">
					{#each step.docs as d (d.id)}
						<button role="tab" aria-selected={d.id === doc?.id} class="max-w-56 truncate" title={d.name} onclick={() => (docId = d.id)}>
							{d.name}{#if d.format === 'txt'}<span class="ml-1.5 rounded bg-ground px-1 text-[11px] font-semibold text-muted">TXT</span>{/if}
						</button>
					{/each}
					<label class="flex h-9 cursor-pointer items-center gap-1 rounded-[7px] px-3 text-sm font-semibold text-muted hover:text-ink">
						<Icon name="plus" size={15} />
						{uploading ? 'Завантаження…' : 'Документ'}
						<input
							type="file"
							accept=".docx,.txt"
							multiple
							class="sr-only"
							onchange={(e) => {
								upload(e.currentTarget.files);
								e.currentTarget.value = '';
							}}
						/>
					</label>
				</div>
				<div class="flex-1"></div>
				<ul aria-label="Позначення" class="flex flex-wrap gap-3.5 text-[13px] text-muted">
					<li class="flex items-center gap-1.5"><span class="h-3 w-4 rounded-sm bg-own shadow-[inset_0_-2px_0_var(--color-own-line)]"></span>вводиться тут</li>
					<li class="flex items-center gap-1.5"><span class="h-3 w-4 rounded-sm bg-inh shadow-[inset_0_-2px_0_var(--color-inh-line)]"></span>з попереднього кроку</li>
					<li class="flex items-center gap-1.5"><span class="w-4 border-t-2 border-dashed border-hint"></span>підказка</li>
				</ul>
			</div>

			{#if doc && previews[doc.id]}
				<div class="card mb-4 flex flex-wrap items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm">
					<span class="text-muted">Назва файлу:</span>
					{#if editingName}
						<input
							class="input h-9 flex-1"
							bind:value={doc.outputName}
							aria-label="Шаблон назви файлу"
							placeholder="напр. Наказ {'{'}ПІБ працівника{'}'}"
							onkeydown={(e) => e.key === 'Enter' && (editingName = false)}
						/>
						<button class="btn btn-sm" onclick={() => (editingName = false)}>Готово</button>
					{:else}
						<span class="flex min-w-60 flex-1 flex-wrap items-center gap-1.5">
							{#each nameParts as part, i (i)}
								{#if part.kind}
									<span
										class="rounded-md px-2 py-0.5 text-[13px] font-semibold {part.kind === 'own'
											? 'bg-own-soft text-own-ink'
											: part.kind === 'inh'
												? 'bg-inh-soft text-inh-ink'
												: 'bg-danger-soft text-danger'}"
										title={part.kind === 'missing' ? 'Немає поля з такою назвою' : undefined}>{part.text}</span
									>
								{:else}{part.text}{/if}
							{/each}
							<span class="text-muted">.{doc.format ?? 'docx'}</span>
						</span>
						<button class="btn btn-sm" onclick={() => (editingName = true)}>Змінити</button>
					{/if}
					<a class="btn btn-sm btn-ghost no-underline" href="/api/documents/{doc.id}" download>
						<Icon name="download" /> Зразок
					</a>
					<button class="btn btn-sm btn-ghost btn-icon" aria-label="Видалити документ" onclick={() => deleteDoc(doc)}>
						<Icon name="trash" />
					</button>
				</div>

				<p class="mb-3 text-[13px] text-muted">
					Виділіть фрагмент, що змінюється, — створіть з нього поле або візьміть значення з попереднього кроку.
					Клік по позначці чи нотатці на полях — змінити її.
				</p>
				<DocPreview preview={previews[doc.id]} {ranges} {active} {notes} {onselect} {onrangeclick} onerror={say} />
			{:else}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="flex min-h-96 flex-col items-center justify-center rounded-2xl border-2 border-dashed p-10 text-center {dragOver
						? 'border-accent bg-accent-soft'
						: 'border-[#b8c0cc]'}"
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
					<span class="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-line bg-surface">
						<Icon name="upload" size={24} />
					</span>
					<p class="mb-2 text-lg font-semibold">Завантажте зразки документів цього кроку</p>
					<p class="mb-5 max-w-md text-sm text-muted">
						Перетягніть сюди один або кілька заповнених документів .docx або .txt. Потім виділіть у них частини, що змінюються.
					</p>
					<label class="btn btn-primary cursor-pointer">
						Обрати файли
						<input type="file" accept=".docx,.txt" multiple class="sr-only" onchange={(e) => upload(e.currentTarget.files)} />
					</label>
				</div>
			{/if}
		</section>

		<aside aria-label="Поля" class="flex max-w-[400px] flex-[1_1_320px] flex-col gap-4">
			<section class="card p-[18px]">
				<h2 class="section-title mb-1">Поля кроку <span class="font-medium text-muted">· {step.fields.length}</span></h2>
				<p class="mb-3 text-[13px] text-muted">
					{step.fields.length ? 'Заповнюються під час формування документів.' : 'Виділіть текст у документі, щоб створити поле.'}
				</p>
				<ul class="flex flex-col gap-1">
					{#each step.fields as f (f.id)}
						{@const opts = defaultOptions(f.id)}
						{@const open = expandedField === f.id}
						<li class="rounded-[10px] {activeField === f.id || open ? 'bg-sunken' : ''}">
							<div class="flex items-center gap-1">
								<button
									class="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5 rounded-[10px] p-2.5 text-left hover:bg-sunken"
									aria-expanded={open}
									onclick={() => (expandedField = open ? null : f.id)}
								>
									<span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] bg-own-soft text-own-ink">
										<Icon name="pencil" size={14} stroke={2.2} />
									</span>
									<span class="min-w-0">
										<span class="block truncate text-sm font-semibold">{f.label}</span>
										<span class="block truncate text-[13px] text-muted">
											{#if f.defaultFrom}авто: {labelOf(f.defaultFrom.fieldId)}{describeTransform(f.defaultFrom.transform) ? ` · ${describeTransform(f.defaultFrom.transform)}` : ''}{:else}зразок «{f.example}»{/if}
										</span>
									</span>
								</button>
								<button
									class="btn btn-ghost btn-sm shrink-0 px-2 {activeField === f.id ? 'text-accent' : ''}"
									title="Показати в документі"
									aria-pressed={activeField === f.id}
									onclick={() => focusField(f.id)}
								>
									{plural(markCount(f.id), 'місце', 'місця', 'місць')}
								</button>
							</div>
							{#if open}
								<div class="grid gap-3 px-2.5 pt-1 pb-3">
									<label>
										<span class="label">Назва поля</span>
										<input class="input h-10" bind:value={f.label} />
									</label>
									<p class="text-[13px] text-muted">Зразок: «{f.example}»</p>
									<label class="flex items-center gap-2 text-sm">
										<input type="checkbox" checked={!!f.multiline} onchange={(e) => (f.multiline = e.currentTarget.checked)} />
										Багаторядкове
									</label>
									{#if opts.length}
										<div class="grid gap-2 rounded-[10px] border border-line bg-surface p-3">
											<label>
												<span class="label">Автозаповнення</span>
												<select
													class="input h-10"
													value={f.defaultFrom?.fieldId ?? ''}
													onchange={(e) => {
														const v = e.currentTarget.value;
														f.defaultFrom = v ? { fieldId: v, transform: f.defaultFrom?.transform } : null;
													}}
												>
													<option value="">— не заповнювати автоматично —</option>
													{#each opts as o (o.field.id)}
														<option value={o.field.id}>{o.stepIndex === stepIndex ? '' : `Крок ${o.stepIndex + 1} · `}{o.field.label}</option>
													{/each}
												</select>
											</label>
											{#if f.defaultFrom}
												{@const src = fieldLocation(wf.steps, f.defaultFrom.fieldId)}
												<TransformEditor
													value={f.defaultFrom.transform}
													onchange={(t) => {
														if (f.defaultFrom) f.defaultFrom = { fieldId: f.defaultFrom.fieldId, ...(t ? { transform: t } : {}) };
													}}
												/>
												{#if src}
													<p class="text-[13px] text-muted">
														Приклад: <TransformPreview value={src.field.example} transform={f.defaultFrom.transform} />
													</p>
												{/if}
												<p class="text-[13px] text-muted">Якщо лишити поле порожнім, значення візьметься звідси.</p>
											{/if}
										</div>
									{/if}
									<button class="btn btn-sm btn-danger justify-self-start" onclick={() => deleteField(f.id)}>
										<Icon name="trash" /> Видалити поле
									</button>
								</div>
							{/if}
						</li>
					{/each}
				</ul>
			</section>

			{#if inherited.length}
				<section class="card p-[18px]">
					<h2 class="section-title mb-3">З попередніх кроків <span class="font-medium text-muted">· {inherited.length}</span></h2>
					<ul class="flex flex-col text-sm">
						{#each inherited as o (o.field.id)}
							<li>
								<button
									class="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-1 py-2 text-left hover:bg-sunken {activeField === o.field.id ? 'bg-sunken' : ''}"
									aria-pressed={activeField === o.field.id}
									onclick={() => focusField(o.field.id)}
								>
									<Icon name="link" size={15} stroke={2.2} class="text-inh-line" />
									<span class="min-w-0 flex-1 truncate">{o.field.label}</span>
									<span class="text-[13px] text-muted">крок {o.stepIndex + 1} · ×{o.count}</span>
								</button>
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			{#if suggestions.length}
				<section class="rounded-2xl border border-hint-border bg-hint-soft p-[18px]">
					<h2 class="section-title mb-1 text-[#2e1f7a]">Підказки</h2>
					<p class="mb-3 text-[13px] text-[#4a3f7a]">
						Знайдено значення полів у документах кроку — з урахуванням відмінків і форматів імені.
					</p>
					<ul class="flex flex-col gap-2">
						{#each suggestions as s (s.fieldId + JSON.stringify(s.transform ?? {}))}
							{@const t = describeTransform(s.transform)}
							<li class="flex flex-col gap-2 rounded-xl border border-dashed border-[#a897f0] bg-surface p-3">
								<span class="font-paper text-[17px]">«{s.text}»</span>
								<span class="flex flex-wrap items-center gap-2 text-[13px] text-hint-ink">
									<span class="flex-1">→ {labelOf(s.fieldId)}{t ? ` · ${t}` : ''} · {plural(s.occurrences.length, 'місце', 'місця', 'місць')}</span>
									<button class="btn btn-sm border-0 bg-hint-strong text-white hover:bg-hint-ink" onclick={() => applySuggestion(s)}>Позначити</button>
								</span>
							</li>
						{/each}
					</ul>
					{#if suggestions.length > 1}
						<button
							class="btn btn-sm mt-3 w-full border-hint-border text-hint-ink"
							onclick={() => {
								for (const s of suggestions) applySuggestion(s);
							}}
						>
							Позначити всі підказки
						</button>
					{/if}
				</section>
			{/if}
		</aside>
	</div>
{/if}

{#if popover && step}
	{#key popover.kind === 'mark' ? popover.markId : `${popover.range.para}:${popover.range.start}`}
		<MarkPopover
			mode={popover.kind === 'mark' && popMark
				? { kind: 'mark', mark: popMark, text: markText(popMark), rect: popover.rect }
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
	<div class="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-ink px-4 py-2.5 text-sm text-white shadow-lg" role="status">
		{toast}
	</div>
{/if}
