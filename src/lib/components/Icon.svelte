<script lang="ts" module>
	const PATHS = {
		pencil: 'M4 20h4L19 9l-4-4L4 16v4z',
		link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
		check: 'm5 12 5 5 9-10',
		chevron: 'm9 6 6 6-6 6',
		'chevron-left': 'm15 6-6 6 6 6',
		plus: 'M12 5v14M5 12h14',
		x: 'M6 6l12 12M18 6 6 18',
		arrow: 'M5 12h14m-6-6 6 6-6 6',
		download: 'M12 4v11m-5-5 5 5 5-5M5 20h14',
		up: 'm6 15 6-6 6 6',
		down: 'm6 9 6 6 6-6',
		trash: 'M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13',
		search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16-3.5-3.5',
		file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5',
		upload: 'M12 20V9m-5 5 5-5 5 5M5 4h14',
		sparkle: 'M12 3v4m0 10v4M3 12h4m10 0h4M6 6l2.5 2.5m7 7L18 18M6 18l2.5-2.5m7-7L18 6',
		alert:
			'M12 8v5m0 3.5v.5M10.3 4.2 2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z'
	} as const;
	export type IconName = keyof typeof PATHS;
</script>

<script lang="ts">
	let {
		name,
		size = 16,
		stroke = 2,
		class: cls = ''
	}: { name: IconName; size?: number; stroke?: number; class?: string } = $props();
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width={stroke}
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
	class="shrink-0 {cls}"><path d={PATHS[name]} /></svg>
