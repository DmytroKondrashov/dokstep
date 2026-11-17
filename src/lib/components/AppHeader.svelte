<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';
	import Logo from './Logo.svelte';

	interface Props {
		/** Breadcrumb after the logo; the last item is the current page. */
		crumbs?: { href?: string; label: string }[];
		/** Content after the breadcrumb (e.g. an editable title). */
		title?: Snippet;
		actions?: Snippet;
	}

	let { crumbs = [], title, actions }: Props = $props();
</script>

<header class="border-b border-line bg-surface">
	<div class="flex min-h-16 flex-wrap items-center gap-x-5 gap-y-2 px-6 py-2.5">
		<a href="/" class="flex items-center gap-2.5 text-[19px] font-bold tracking-tight text-ink no-underline">
			<Logo />
			{#if !crumbs.length && !title}Dokstep{/if}
		</a>
		{#if crumbs.length || title}
			<nav aria-label="Шлях" class="flex min-w-0 items-center gap-2 text-[15px]">
				{#each crumbs as c, i (i)}
					{#if c.href}
						<a href={c.href} class="text-muted no-underline hover:text-ink">{c.label}</a>
					{:else}
						<span class="truncate text-[17px] font-semibold">{c.label}</span>
					{/if}
					{#if i < crumbs.length - 1 || title}<Icon name="chevron" size={14} class="text-faint" />{/if}
				{/each}
				{@render title?.()}
			</nav>
		{/if}
		<div class="flex-1"></div>
		{#if actions}
			<div class="flex flex-wrap items-center gap-3">{@render actions()}</div>
		{/if}
	</div>
</header>
