# How Sirius versions itself

`package.json`'s `version` is not a marketing number. It is the compatibility
contract every extension is checked against, and picking it freely breaks the
editor in a way that is not obvious until users try to install something.

## What happens if Sirius versions itself 0.1.0

An extension declares what it needs:

```json
"engines": { "vscode": "^1.85.0" }
```

The editor compares that against its own version in
`extensionValidator.ts:isValidVersion`:

```ts
if (majorBase < desiredMajorBase) {
    return false;
}
```

At version `0.1.0` the major is `0`, the extension wants `1`, and the extension
is rejected as incompatible. Not just some extensions — every extension on Open
VSX that declares a `^1.x` engine, which is essentially all of them. Built-in
extensions are exempt, so the editor looks fine until someone opens the
marketplace.

## What Sirius does instead

The version tracks the upstream base: `1.118.0` means "compatible with the
extension API of VS Code 1.118".

Sirius's own releases move the patch:

| Release | Version | Why |
| --- | --- | --- |
| First release | `1.118.0` | The 1.118 base, no Sirius changes to the number yet |
| Sirius-only fixes | `1.118.1`, `1.118.2` | Same base, our work |
| After rebasing onto upstream 1.119 | `1.119.0` | New base |

The git tag matches the version, so the tag, the About box, the release page and
the update server all agree. That agreement is the point: a user reading `1.118.2`
in About can find exactly that release.

## If Sirius really needs its own number

It is possible — Cursor does it — but it means separating "the version we
display" from "the version extensions are checked against". That version is read
in about a dozen places across the gallery service, the extension scanner and the
remote extension host, and each one would need to take the compatibility version
instead. It is a real project, and every rebase has to keep the split intact.

Worth doing if Sirius diverges far enough that the upstream number is misleading.
Not worth doing before a first release.
