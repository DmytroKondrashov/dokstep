<script lang="ts">
	import '../app.css';

	let { children } = $props();
</script>

<svelte:head>
	<title>Dokstep — конструктор документів</title>
</svelte:head>

<header class="border-b border-slate-200 bg-white">
	<div class="mx-auto flex h-12 items-center gap-4 px-4">
		<a href="/" class="flex items-center gap-2 font-semibold">
			<img src="/favicon.svg" alt="" class="h-5 w-5" />
			Dokstep
		</a>
		<span class="text-sm text-slate-500">процеси та документи за зразками</span>
	</div>
</header>

{@render children()}
