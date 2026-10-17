# UploadFit third-party codec notice

This notice applies to every UploadFit production build that embeds
the MP3 encoder described below. It must travel with the build and the build
must retain the short prominent notice emitted by the bundler.

## lamejs 1.2.1

- Component: `lamejs` version `1.2.1`
- Function: local PCM-to-MP3 encoding
- Upstream: <https://github.com/zhuker/lamejs/tree/v1.2.1>
- npm coordinates: `lamejs@1.2.1`
- Package integrity: `sha1-D5LThykhPxBtShne0ggh2n6JyOQ=`
- Package-declared SPDX identifier: `LGPL-3.0`
- The vendor source archive is unmodified. The build bundles/minifies
  `lame.min.js`, normalizes whitespace and replaces two inert URL strings;
  see `RELINKING.md` and `esbuild.config.js`.
- Published `lame.min.js` SHA-256:
  `15D285E2587B3BDBFD18A68DE6CE07CC074F7480A82C3815DA2DC1C348EC6DF4`
- Published `lame.all.js` SHA-256:
  `026BD88846040F357A937CD85821A48492A362EFF0812CDA734F23FCA55FEA3B`

The npm metadata declares `LGPL-3.0`. The package root `LICENSE` is a short
424-byte usage notice rather than the complete GNU license. The package also
contains an older `src/main/java/COPYING` headed "GNU LIBRARY GENERAL PUBLIC
LICENSE, Version 2" inherited from its Java/LAME lineage. UploadFit preserves
all of these facts instead of silently treating the short notice as the full
license text:

- `lamejs-1.2.1-LICENSE.txt` — upstream 424-byte notice
- `LGPL-3.0.txt` — complete package-declared license text from GNU
- `GPL-3.0.txt` — GPLv3 text incorporated by LGPLv3
- `lamejs-embedded-COPYING-LGPL-2.0.txt` — historical text shipped
  inside the npm package
- `RELINKING.md` — exact replacement/rebuild and release-package conditions

The selected engineering distribution path is a relinkable source release.
The Tabbit script remains one self-contained IIFE with no remote runtime
dependency, while the release package also carries the buildable UploadFit
source, exact dependency lock, notices and instructions needed to replace the
encoder and rebuild the combined work. The Tabbit share link alone is not the
complete release package.

No warranty or legal opinion is provided by this engineering notice. A public
release owner must preserve the materials and permissions in `RELINKING.md`;
if they cannot, the build containing this encoder must not be published.

## use-strict 1.0.1

- Component: `use-strict` version `1.0.1`
- License: ISC
- License text: `use-strict-1.0.1-LICENSE.txt`

This package is a transitive build dependency of `lamejs@1.2.1` and is locked
by `package-lock.json`.

The complete original npm source package is included as `vendor/lamejs-1.2.1.tgz`.
UploadFit original code is MIT licensed; see the root `LICENSE` and `NOTICE`.
