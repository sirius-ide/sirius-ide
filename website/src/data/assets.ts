/** Which release asset is which, by name — the release workflow's naming at 1.118.7. */
import type { Release, ReleaseAsset } from './release';

export type AssetKind =
	| 'linux-x64-tar' | 'linux-arm64-tar' | 'deb-amd64' | 'deb-arm64' | 'rpm-x86_64' | 'rpm-aarch64'
	| 'arch-pkg' | 'server-x64' | 'server-arm64' | 'win32-x64-setup' | 'commit';

const patterns: Array<[AssetKind, RegExp]> = [
	['linux-x64-tar', /^sirius-linux-x64\.tar\.gz$/],
	['linux-arm64-tar', /^sirius-linux-arm64\.tar\.gz$/],
	['deb-amd64', /^sirius_.*_amd64\.deb$/],
	['deb-arm64', /^sirius_.*_arm64\.deb$/],
	['rpm-x86_64', /^sirius-.*\.x86_64\.rpm$/],
	['rpm-aarch64', /^sirius-.*\.aarch64\.rpm$/],
	['arch-pkg', /^sirius-ide-bin-.*\.pkg\.tar\.zst$/],
	['server-x64', /^sirius-server-linux-x64\.tar\.gz$/],
	['server-arm64', /^sirius-server-linux-arm64\.tar\.gz$/],
	['win32-x64-setup', /^sirius-win32-x64-setup\.exe$/],
	['commit', /^commit\.txt$/],
];

export function kindOf(asset: ReleaseAsset): AssetKind | undefined {
	return patterns.find(([, re]) => re.test(asset.name))?.[0];
}

export function assetByKind(release: Release, kind: AssetKind): ReleaseAsset | undefined {
	return release.assets.find((a) => kindOf(a) === kind);
}
