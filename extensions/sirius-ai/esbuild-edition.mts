/*---------------------------------------------------------------------------------------------
 *  Sirius for VS Code — the edition's build
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// Builds the VS Code edition into dist/edition: its manifest (vscode-edition/package.json), the
// extension (src/vscode/extension.ts, for Node) and the panel's webview (src/panel/webview, for
// the browser), its stylesheet and icon, Microsoft's codicons, and the licences of the code it
// bundles. The folder runs as is with `code --extensionDevelopmentPath=dist/edition`.
//   node esbuild-edition.mts [--dev]
import * as fs from 'node:fs';
import * as path from 'node:path';
import esbuild from 'esbuild';

const here = import.meta.dirname;
const repo = path.join(here, '..', '..');
const out = path.join(here, 'dist', 'edition');
const dev = process.argv.includes('--dev');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'dist'), { recursive: true });
fs.mkdirSync(path.join(out, 'media', 'codicons'), { recursive: true });
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
copy(path.join(here, 'vscode-edition', 'media', 'sirius.svg'), path.join('media', 'sirius.svg'));
copy(path.join(here, 'src', 'panel', 'webview', 'panel.css'), path.join('media', 'panel.css'));
const codicons = path.join(repo, 'node_modules', '@vscode', 'codicons', 'dist');
copy(path.join(codicons, 'codicon.css'), path.join('media', 'codicons', 'codicon.css'));
copy(path.join(codicons, 'codicon.ttf'), path.join('media', 'codicons', 'codicon.ttf'));
copy(path.join(repo, 'src', 'vs', 'base', 'common', 'marked', 'marked.license.txt'), path.join('licenses', 'marked.txt'));
copy(path.join(repo, 'src', 'vs', 'base', 'browser', 'dompurify', 'dompurify.license.txt'), path.join('licenses', 'dompurify.txt'));
copy(path.join(repo, 'node_modules', '@vscode', 'codicons', 'LICENSE'), path.join('licenses', 'codicons.txt'));
console.log(`edition → ${out}`);
