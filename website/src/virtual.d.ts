// Starlight's own build-time module with the Pagefind options from astro.config.mjs (used by components/search-ui.ts).
declare module 'virtual:starlight/pagefind-config' {
	export const pagefindUserConfig: Record<string, unknown>;
}
