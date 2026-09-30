# Installing Sirius IDE

## Arch Linux (recommended)

Add the Sirius repository to `/etc/pacman.conf`:

```ini
[sirius]
SigLevel = Optional
Server = https://dl.siriuside.com/arch/$arch
```

Then install like any package:

```bash
sudo pacman -Syu sirius-ide-bin
```

Updates arrive with your normal `pacman -Syu`. The repository is served from
the same zero-egress CDN as every Sirius download, and the release workflow
publishes each tag to it in the same run that publishes the GitHub release, so
it never trails. The package is built from the same release tarball whose
provenance you can verify with `gh attestation verify`, and the `.pkg.tar.zst`
is also attached to every release, so `sudo pacman -U <that url>` works without
adding the repository. It currently serves `x86_64` only — on an aarch64 Arch
install, `$arch` resolves to a path that does not exist yet; use the tarball below.
The PKGBUILD lives in the repository at `build/arch/sirius-ide-bin/`.

An AUR package will follow once the AUR reopens new-account registration
(paused during their malicious-packages incident); the repository above is the
first-class path either way. `sirius-ide-git`, which compiles from source,
also arrives with the AUR — expect tens of minutes and ~8 GB of RAM if you
choose it.

## Debian, Ubuntu

```bash
sudo apt install ./sirius_*_amd64.deb   # x86_64
sudo apt install ./sirius_*_arm64.deb   # arm64 / aarch64
```

Download the `.deb` from the [latest release](https://github.com/sirius-ide/sirius-ide/releases/latest).
The package is named `sirius` and its version carries a build stamp, so the glob
is deliberate. Both architectures ship together from the first release after
v1.118.6 on: the release pipeline installs and runs each package on Debian 12
and Ubuntu 22.04 before anything is published. The arm64 package additionally
needs GCC 9's libstdc++ (GLIBCXX 3.4.26): Debian 11, Ubuntu 20.04 or newer.

Unlike upstream VS Code, this package does **not** add a third-party apt
repository or signing key to your system. Update by installing a newer `.deb`,
or let the editor notify you when one is available.

## Fedora, RHEL

```bash
sudo dnf install ./sirius-*.x86_64.rpm    # x86_64
sudo dnf install ./sirius-*.aarch64.rpm   # arm64 / aarch64
```

Same naming note as the `.deb`; both architectures are installed and run on
Rocky Linux 9 by the release pipeline (aarch64 from the first release after
v1.118.6 on, and it needs GLIBCXX 3.4.26 — RHEL 9 or newer).

## Any Linux (tarball)

```bash
tar -xzf sirius-linux-x64.tar.gz      # or sirius-linux-arm64.tar.gz
./VSCode-linux-x64/bin/sirius         # VSCode-linux-arm64 on arm64
```

Both tarballs are built against a glibc 2.28 sysroot — the arm64 one
cross-compiled with the same toolchain upstream VS Code uses — and need glibc
2.28 or newer; arm64 additionally needs GCC 9's libstdc++ (GLIBCXX 3.4.26).
The release pipeline runs the arm64 tarball on Debian 12.

To get a menu entry, copy the desktop file and icon into place:

```bash
install -Dm644 VSCode-linux-x64/resources/app/resources/linux/code.png \
  ~/.local/share/icons/hicolor/1024x1024/apps/sirius-ide.png
cat > ~/.local/share/applications/sirius-ide.desktop <<'DESKTOP'
[Desktop Entry]
Name=Sirius IDE
Comment=The agentic, AI-native code editor
Exec=/full/path/to/VSCode-linux-x64/bin/sirius %F
Icon=sirius-ide
Type=Application
Categories=TextEditor;Development;IDE;
StartupWMClass=Sirius
DESKTOP
update-desktop-database ~/.local/share/applications
```

## Remote development (SSH, containers)

Every release ships the Sirius server for `linux-x64` and `linux-arm64`
(`sirius-server-linux-<arch>.tar.gz`), the headless half that a remote
extension installs on the machine you connect to. `product.json` points remote
extensions at it (`serverDownloadUrlTemplate`), so Open Remote - SSH and
compatible extensions install it on first connect with no configuration; to
place it yourself, unpack the tarball on the remote host and run
`bin/sirius-server`. Both servers need glibc 2.28 and a libstdc++ with
GLIBCXX 3.4.25 or newer — Debian 10, Ubuntu 20.04 and RHEL 8 or newer — which
`bin/helpers/check-requirements.sh` verifies before it starts; the arm64 server
is cross-compiled against the same glibc-2.28 sysroot as x64, and the release
pipeline starts it on Debian 12, Ubuntu 22.04 and Rocky 9 arm64. Alpine (musl)
is not built.

## Windows

Run the installer from the [latest release](https://github.com/sirius-ide/sirius-ide/releases/latest):

```
sirius-win32-x64-setup.exe
```

Windows builds are **not code-signed yet**, so SmartScreen will warn on first
run — choose "More info" then "Run anyway". Signing is tracked in the roadmap.

Windows updates in place: the editor downloads and installs new versions itself.

## macOS

Not yet built. The packaging exists but macOS releases need an Apple Developer
certificate for signing and notarisation, without which Gatekeeper refuses the
app.

## After installing

Sirius needs a model. Either add a provider key, or run models locally.

**A hosted provider** — `Ctrl+Shift+P` → `Sirius: Set API Key`. Keys go to your
system keyring, never to `settings.json`.

**Local models**, with nothing leaving your machine:

```bash
sudo pacman -S ollama          # or your distro's package
ollama serve
ollama pull qwen3
```

Sirius finds a running Ollama automatically. LM Studio, llama.cpp and vLLM work
the same way.

Pick a model with `Ctrl+Shift+M`, or from the model picker at the bottom of the
chat panel.

## Updating

| How you installed | How it updates |
| --- | --- |
| Sirius pacman repo | `sudo pacman -Syu` (the repo is updated by the release itself) |
| `.deb` / `.rpm` | Install a newer package |
| Tarball | The editor notifies you and opens the download page |
| Windows installer | In place, automatically |

On Linux the editor notifies rather than replacing itself, because a package
installed by your distribution is not the editor's to overwrite.
