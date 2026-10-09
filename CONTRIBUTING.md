# Contributing to Sirius IDE

Thank you for taking the time. Sirius is developed by Clicksora, L.L.C. and ships under its
own licence (see [LICENSE.txt](LICENSE.txt)); it is a derivative of the MIT-licensed
Code - OSS. Here is how to help, and what we can and cannot take.

## Bug reports

Open an [issue](https://github.com/sirius-ide/sirius-ide/issues/new/choose) with the bug
report form: the Sirius version (**Help → About**), your platform and how you installed it,
numbered steps to reproduce, and what you expected. If the chat, the agent or Tab completion
is involved, name the model provider. Check the
[troubleshooting page](https://siriuside.com/docs/troubleshooting/) first — it answers the
common setup problems.

## Feature requests

Use the feature request form. Describe the problem before the solution: what you were doing
and what got in the way. The [roadmap](https://siriuside.com/roadmap/) shows what is already
planned.

## Security vulnerabilities

**Never in a public issue.** Report them privately through
[GitHub's security advisories](https://github.com/sirius-ide/sirius-ide/security/advisories/new);
[SECURITY.md](SECURITY.md) has the details and the scope.

## Pull requests

Sirius does not accept pull requests at this time. The code is proprietary, every release is
built and signed from this repository by CI, and each change is reviewed and tested by the
maintainer before it ships — so outside code cannot be merged without a contributor
agreement and a review process that do not exist yet. A pull request opened without prior
agreement is closed without review.

If you have a change in mind, open an issue describing the problem and your proposed fix. If
it is something we want, we will say so and discuss how it lands. This may change in a
future release; when it does, this file will say how.

## Documentation

Mistakes and gaps in the [documentation](https://siriuside.com/docs/) are bugs: file them as
such, with the page and the sentence.

## Building from source

The [README](README.md#building-from-source) covers it. Sirius builds like VS Code, with the
same prerequisites; the one hard rule is the Node version in `.nvmrc`.
