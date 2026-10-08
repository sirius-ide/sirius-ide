/**
 * The Pagefind search UI, split out of the page so it is fetched only when someone opens search
 * (StarlightSearch.astro imports this on demand). Its stylesheet comes as a string inside this
 * chunk and is added to the page here: a plain `import 'x.css'` would be collected by the build into
 * every docs page's own CSS, which is the ~24 KB this split exists to keep out. The options are
 * Starlight's own.
 *
 * `@pagefind/default-ui` is Starlight's dependency, hoisted by npm; it ships no type declarations.
 */
import resultsCss from '../styles/search-results.css?inline';
// @ts-expect-error — Missing types for @pagefind/default-ui.
import { PagefindUI } from '@pagefind/default-ui';
import { pagefindUserConfig } from 'virtual:starlight/pagefind-config';

export function mount(translations: Record<string, string>): void {
	const style = document.createElement('style');
	style.textContent = resultsCss;
	document.head.append(style);
	new PagefindUI({
		...pagefindUserConfig,
		element: '#starlight__search',
		baseUrl: import.meta.env.BASE_URL,
		bundlePath: import.meta.env.BASE_URL.replace(/\/$/, '') + '/pagefind/',
		showImages: false,
		translations,
		showSubResults: true,
	});
}
