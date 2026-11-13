/*---------------------------------------------------------------------------------------------
 *  Sirius for VS Code — the edition's build
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// Builds the VS Code edition into dist/edition: its manifest (vscode-edition/package.json), the
// extension (src/vscode/extension.ts, for Node) and the panel's webview (src/panel/webview, for
// the browser), its stylesheet and icons, the walkthrough's pages, Microsoft's codicons, the
// listing's README and CHANGELOG, Sirius's licence agreement, and the licences of the code it
// bundles. The folder runs as is with `code --extensionDevelopmentPath=dist/edition`, and is what
// vscode-edition/package.sh packages. esbuild and the codicons come from vscode-edition/tools when
// installed there (pinned, as CI uses them), else from the repository's own node_modules.
//   node esbuild-edition.mts [--dev]
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';

const here = import.meta.dirname;
const repo = path.join(here, '..', '..');
const tools = path.join(here, 'vscode-edition', 'tools', 'node_modules');
const fromTools = fs.existsSync(path.join(tools, 'esbuild'));
const esbuild = createRequire(fromTools ? path.join(here, 'vscode-edition', 'tools', 'package.json') : import.meta.url)('esbuild') as typeof import('esbuild');
const out = path.join(here, 'dist', 'edition');
const dev = process.argv.includes('--dev');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'dist'), { recursive: true });
fs.mkdirSync(path.join(out, 'media', 'codicons'), { recursive: true });
fs.mkdirSync(path.join(out, 'media', 'walkthrough'), { recursive: true });
fs.mkdirSync(path.join(out, 'licenses'), { recursive: true });

const common = { bundle: true, minify: !dev, sourcemap: dev, logLevel: 'warning' as const, logOverride: { 'import-is-undefined': 'error' as const } };
await esbuild.build({
	...common,
	entryPoints: { edition: path.join(here, 'src', 'vscode', 'extension.ts') },
	platform: 'node', format: 'cjs', target: ['es2024'], external: ['vscode'], mainFields: ['module', 'main'],
	outdir: path.join(out, 'dist')
});
await esbuild.build({
	...common,
	entryPoints: { panel: path.join(here, 'src', 'panel', 'webview', 'main.ts') },
	platform: 'browser', format: 'iife', target: ['es2022'],
	outdir: path.join(out, 'dist')
});

const copy = (from: string, to: string) => fs.copyFileSync(from, path.join(out, to));
copy(path.join(here, 'vscode-edition', 'package.json'), 'package.json');
copy(path.join(here, 'vscode-edition', 'README.md'), 'README.md');
copy(path.join(here, 'vscode-edition', 'CHANGELOG.md'), 'CHANGELOG.md');
copy(path.join(repo, 'LICENSE.txt'), 'LICENSE.txt');
copy(path.join(here, 'vscode-edition', 'media', 'icon.png'), path.join('media', 'icon.png'));
copy(path.join(here, 'vscode-edition', 'media', 'sirius.svg'), path.join('media', 'sirius.svg'));
copy(path.join(here, 'src', 'panel', 'webview', 'panel.css'), path.join('media', 'panel.css'));
for (const page of fs.readdirSync(path.join(here, 'vscode-edition', 'media', 'walkthrough'))) {
	copy(path.join(here, 'vscode-edition', 'media', 'walkthrough', page), path.join('media', 'walkthrough', page));
}
const codiconsPackage = path.join(fromTools ? tools : path.join(repo, 'node_modules'), '@vscode', 'codicons');
const codicons = path.join(codiconsPackage, 'dist');
copy(path.join(codicons, 'codicon.css'), path.join('media', 'codicons', 'codicon.css'));
copy(path.join(codicons, 'codicon.ttf'), path.join('media', 'codicons', 'codicon.ttf'));
copy(path.join(repo, 'src', 'vs', 'base', 'common', 'marked', 'marked.license.txt'), path.join('licenses', 'marked.txt'));
copy(path.join(repo, 'src', 'vs', 'base', 'browser', 'dompurify', 'dompurify.license.txt'), path.join('licenses', 'dompurify.txt'));
copy(path.join(codiconsPackage, 'LICENSE'), path.join('licenses', 'codicons.txt'));
// What a package leaves out: a --dev build's source maps.
fs.writeFileSync(path.join(out, '.vscodeignore'), '**/*.map\n');
console.log(`edition → ${out}`);
