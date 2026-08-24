# Installing Sirius IDE

## Arch Linux (recommended)

```bash
yay -S sirius-ide-bin
```

`sirius-ide-bin` installs the prebuilt release. There is also `sirius-ide-git`,
which compiles from source — that takes tens of minutes and about 8 GB of RAM,
so prefer the binary package unless you want to track the branch.

Updates come through your package manager:

```bash
yay -Syu
```

## Debian, Ubuntu

```bash
sudo apt install ./sirius-ide_<version>_amd64.deb
```

Download the `.deb` from the [latest release](https://github.com/sirius-ide/sirius-ide/releases/latest).

Unlike upstream VS Code, this package does **not** add a third-party apt
repository or signing key to your system. Update by installing a newer `.deb`,
or let the editor notify you when one is available.

## Fedora, RHEL, openSUSE

```bash
sudo dnf install ./sirius-ide-<version>.x86_64.rpm
```

## Any Linux (tarball)

```bash
tar -xzf sirius-linux-x64.tar.gz
./VSCode-linux-x64/bin/sirius
```

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
| AUR | `yay -Syu` |
| `.deb` / `.rpm` | Install a newer package |
| Tarball | The editor notifies you and opens the download page |
| Windows installer | In place, automatically |

On Linux the editor notifies rather than replacing itself, because a package
installed by your distribution is not the editor's to overwrite.
