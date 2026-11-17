<script lang="ts">
	/** A tiny sheet whose lines show the step's marks: yellow = own, green = inherited. */
	let { bars }: { bars: ('own' | 'inh' | 'plain')[] } = $props();
	const widths = ['55%', '90%', '70%', '100%', '45%', '80%'];
	const color = { own: 'bg-[#F5C451]', inh: 'bg-[#7CC7A0]', plain: 'bg-[#E1E5EA]' };
</script>

<div
	class="flex h-[74px] w-[58px] flex-col gap-1 rounded border border-[#d4d9e1] bg-white px-2 py-[9px] shadow-[0_1px_2px_rgb(22_27_38/0.06)]"
	aria-hidden="true"
>
	<div class="h-[3px] w-1/2 self-center rounded-sm bg-[#9AA3B2]"></div>
	{#each bars.slice(0, 6) as b, i (i)}
		<div class="h-[3px] rounded-sm {color[b]}" style:width={widths[i % widths.length]}></div>
	{/each}
</div>
