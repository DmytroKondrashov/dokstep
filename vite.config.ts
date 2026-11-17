/// <reference types="vitest/config" />
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			preprocess: vitePreprocess(),
			adapter: adapter({ out: 'build', precompress: true })
		})
	],
	// shevchenko loads a TensorFlow model; keep it out of the SSR bundle.
	ssr: { external: ['shevchenko'] },
	// Vitest otherwise resolves svelte's server build, where effects never run.
	resolve: process.env.VITEST ? { conditions: ['browser'] } : undefined,
	test: {
		include: ['tests/**/*.test.ts'],
		// keep tests away from the real ./data database
		env: { DATA_DIR: join(tmpdir(), 'dokstep-test') }
	}
});
