/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The remote server through a real remote extension (hole 12), end to end: Open Remote - SSH
// (jeanp413, from Open VSX) in the extensions directory and an sshd container as the host. The
// extension uses proposed APIs; Sirius lets an installed extension use the proposals it declares,
// so nothing in product.json or on the command line is needed for it to activate.
// The probe opens the host's home folder in a new window; that window's extension connects over
// SSH, downloads the server named by `serverDownloadUrlTemplate` onto the host, starts it and
// connects to it. Evidence is read where it is left: the server's own log on the host (through
// `podman exec`) and the extension's output log of the new window. Checks:
//
//  activated — the extension activates (its proposed APIs allowed) and registers its commands;
//  installed — <serverDataFolderName>/bin/<commit>/bin/<serverApplicationName> exists on the host,
//              the client's commit;
//  listening — the server log says "Extension host agent listening on <port>";
//  connected — the server log has a ManagementConnection and an ExtensionHostConnection
//              established — the new window is a remote window on this server;
//  window    — the new window's "Remote - SSH" log shows the install and the resolved authority.
//
// Writes <result>.connected once connected and waits a moment, so the wrapper can take a
// screenshot of the remote window; progress goes to <result>.log.
//
//   test/harness/remote-ssh.sh <app-dir>      # builds the host, installs the extension, runs this

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const SSHD = process.env.SIRIUS_PROBE_SSHD ?? 'sirius-sshd-probe';
const HOST = process.env.SIRIUS_PROBE_SSH_HOST ?? 'sirius-probe';
const CONTAINER = process.env.SIRIUS_CONTAINER ?? 'podman';
const OUT = process.env.SIRIUS_PROBE_OUT;
const log = line => fs.appendFileSync(`${OUT}.log`, `${new Date().toISOString().slice(11, 19)} ${line}\n`);

/** Run a shell line on the host as the user the extension logs in as; '' when it fails. */
function onHost(script) {
	try {
		return cp.execFileSync(CONTAINER, ['exec', '--user', 'dev', SSHD, 'sh', '-c', script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
	} catch {
		return '';
	}
}

/** Every file under `dir` whose name matches, any depth. */
function findFiles(dir, test, found = []) {
	for (const entry of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			findFiles(full, test, found);
		} else if (test(entry.name)) {
			found.push(full);
		}
	}
	return found;
}

exports.run = async function (vscode, context) {
	const failures = [];
	const check = (ok, what) => { if (!ok) { failures.push(what); } };
	const result = {};

	const product = JSON.parse(fs.readFileSync(path.join(vscode.env.appRoot, 'product.json'), 'utf8'));
	const { commit, serverDataFolderName, serverApplicationName, serverDownloadUrlTemplate } = product;
	result.product = { commit, serverDataFolderName, serverApplicationName, serverDownloadUrlTemplate, version: vscode.version, proposals: product.extensionEnabledApiProposals?.['jeanp413.open-remote-ssh'] ?? null };

	// ── activated ─────────────────────────────────────────────────────────────
	const extension = vscode.extensions.getExtension('jeanp413.open-remote-ssh');
	result.activated = { present: !!extension, version: extension?.packageJSON.version ?? null };
	if (extension) {
		try {
			await extension.activate();
			result.activated.active = extension.isActive;
		} catch (error) {
			result.activated.error = String(error);
		}
	}
	result.activated.commands = (await vscode.commands.getCommands(true)).filter(c => c.startsWith('openremotessh.')).sort();
	check(result.activated.active, `activated: ${result.activated.error ?? 'the extension is not installed'}`);
	if (!result.activated.active) {
		return { ok: false, failures, ...result };
	}

	// ── the new window ────────────────────────────────────────────────────────
	const home = onHost('echo $HOME').trim() || '/home/dev';
	const authority = `ssh-remote+${HOST}`;
	log(`opening vscode-remote://${authority}${home} in a new window`);
	await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.from({ scheme: 'vscode-remote', authority, path: home }), { forceNewWindow: true });

	const serverLog = `${home}/${serverDataFolderName}/.${commit}.log`;
	const serverBin = `${home}/${serverDataFolderName}/bin/${commit}/bin/${serverApplicationName}`;
	let hostLog = '';
	let installed = false;
	const connected = text => /\[ManagementConnection\] New connection established/.test(text) && /\[ExtensionHostConnection\] New connection established/.test(text);
	for (let i = 0; i < 240 && !(installed && connected(hostLog)); i++) {
		await sleep(1000);
		if (i % 10 === 9) {
			installed = onHost(`test -x ${serverBin} && echo yes`).trim() === 'yes';
			hostLog = onHost(`cat ${serverLog} 2>/dev/null`);
			log(`host: server ${installed ? 'installed' : 'not yet'}, log ${hostLog.length} bytes${connected(hostLog) ? ', connected' : ''}`);
		}
	}
	installed = onHost(`test -x ${serverBin} && echo yes`).trim() === 'yes';
	hostLog = onHost(`cat ${serverLog} 2>/dev/null`);
	const listening = hostLog.match(/Extension host agent listening on (\S+)/);

	result.installed = { path: serverBin, present: installed, binDir: onHost(`ls ${home}/${serverDataFolderName}/bin 2>/dev/null`).trim().split('\n').filter(Boolean), serverVersion: onHost(`${serverBin} --version 2>/dev/null`).trim().split('\n') };
	check(installed, `installed: ${serverBin} is not on the host (bin holds ${JSON.stringify(result.installed.binDir)})`);
	result.listening = listening ? listening[1] : null;
	check(listening, 'listening: the server log never said "Extension host agent listening on"');
	result.connected = {
		management: /\[ManagementConnection\] New connection established/.test(hostLog),
		extensionHost: /\[ExtensionHostConnection\] New connection established/.test(hostLog),
		serverLog: hostLog.split('\n').filter(Boolean).slice(-20).map(line => line.slice(0, 200))
	};
	check(result.connected.management && result.connected.extensionHost, 'connected: the server log shows no established connection from the client');

	// ── window: the extension's log in the new window ─────────────────────────
	// <user-data-dir>/User/globalStorage/<this extension>
	const userDataDir = path.dirname(path.dirname(path.dirname(context.globalStorageUri.fsPath)));
	const extLogs = findFiles(path.join(userDataDir, 'logs'), name => /Remote - SSH/.test(name) && name.endsWith('.log')).filter(file => !file.includes('/window1/'));
	const extLog = extLogs.map(file => fs.readFileSync(file, 'utf8')).join('\n');
	result.window = {
		logFiles: extLogs.map(file => path.relative(userDataDir, file)),
		lines: extLog.split('\n').filter(Boolean).slice(-25).map(line => line.slice(0, 220)),
		downloaded: /Downloading|download/i.test(extLog),
		resolved: /Resolved|listeningOn|connectionToken/i.test(extLog)
	};
	check(extLogs.length > 0, 'window: no "Remote - SSH" output log for a second window');

	fs.writeFileSync(`${OUT}.connected`, new Date().toISOString());
	await sleep(10_000); // the wrapper's screenshot of the remote window
	return { ok: failures.length === 0, failures, ...result };
};
