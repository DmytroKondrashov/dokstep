<script lang="ts">
	import '../app.css';

	let { children } = $props();
</script>

<svelte:head>
	<title>Dokstep — документи за зразками</title>
</svelte:head>

{@render children()}
