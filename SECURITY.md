# Security

Sirius IDE is maintained by Clicksora, L.L.C. If you find a vulnerability in Sirius —
the editor, the `sirius-ai` extension, the update server, the release pipeline or this
repository — please report it privately.

**Please do not report security vulnerabilities through public GitHub issues,
discussions or pull requests.**

## How to report

Use GitHub's private vulnerability reporting for this repository:

<https://github.com/sirius-ide/sirius-ide/security/advisories/new>

It opens a draft advisory that only you and the maintainer can see. Include what you
can of: the Sirius version (`Help → About`, or `sirius --version`), the platform and how
you installed it, steps to reproduce, and the impact as you understand it. A proof of
concept helps; a working exploit is not required.

You will hear back from the maintainer in the same advisory thread. Fixes ship as a
new release, noted in that release's notes; the advisory is published once a fixed
version is available, with credit to you unless you prefer otherwise.

## Scope

- **In scope:** everything this repository builds and publishes — the Sirius desktop
  editor, the `sirius-server` remote server, the `sirius-ai` extension and its model
  providers, the update server (`build/update-server/`), the release workflow and the
  packages it produces, and the download CDN and pacman repository it publishes to.
- **Upstream Code - OSS:** Sirius is a fork of Code - OSS. A vulnerability in the
  upstream editor affects Sirius too, so report it to us as well as to Microsoft, under
  their policy at <https://aka.ms/SECURITY.md>, and we will ship the fix when it lands.
- **Third-party model providers and extensions** from Open VSX are outside this
  policy; report those to their maintainers.

## Supported versions

Only the latest release receives fixes. Releases are tags on the `sirius` branch; there
are no maintenance branches. The editor tells you when a newer release exists, and
package-manager installs update with the package manager (see
[INSTALL.md](INSTALL.md)).

## Verifying what you run

Every release asset is attested with GitHub's build provenance and carries a `.sha256`
sidecar. Verify a download with:

```bash
gh attestation verify <file> --owner sirius-ide
```
