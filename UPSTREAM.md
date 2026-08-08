# Upstream and provenance

George Showroom is a derivative of [Lavish AXI](https://github.com/kunchenguid/lavish-axi),
created by Kun Chen. The fork began from upstream commit
`542819086b799d907e7eddf0a1fadd2eb60c3dfe` (Lavish AXI v0.1.46).

## License obligations

The upstream project is licensed under the MIT License. George Showroom keeps
the upstream `LICENSE` file and Kun Chen's copyright notice unchanged. Copies
or substantial portions of this software must preserve that copyright notice
and the MIT permission and warranty disclaimer. Third-party attributions remain
in `THIRD-PARTY-NOTICES.md`.

New George Showroom work does not erase upstream authorship. Product copy may
use the George Showroom name, while this document, the README, Git history, and
the retained license record where the implementation came from.

## Upstream sync policy

The `upstream` Git remote should point to
`https://github.com/kunchenguid/lavish-axi.git`. Future syncs should:

1. Fetch `upstream` without pushing or changing it.
2. Review the commits from the last recorded sync point through
   `upstream/main` before integrating them.
3. Merge or cherry-pick deliberately, preserving upstream commit authorship
   and retaining the upstream copyright and license text.
4. Resolve product-identity conflicts in favor of George Showroom's public
   name while keeping documented compatibility boundaries unless a migration
   intentionally removes them.
5. Update this file's recorded sync point in the same reviewed change.

Do not force-push rewritten upstream history into this repository. Releases,
npm publishing, deployment, and remote pushes remain separate owner-approved
actions.
