# Codec replacement and relinking instructions

## Distribution model

UploadFit uses the `lamejs@1.2.1` encoder only under a relinkable source
release model. A release that embeds it must include, in the same downloadable
release package or stable public source snapshot:

1. the complete UploadFit `src/`, `scripts/`, `test-pages/`, `package.json`,
   `package-lock.json`, build configuration and tests needed to rebuild;
2. this directory, including complete GNU license texts and third-party
   notices;
3. the exact generated IIFE bytes/SHA and the source revision used;
4. the unmodified encoder source coordinates and integrity values below; and
5. permission for recipients to modify/reverse-engineer the Combined Work as
   necessary to replace the LGPL component and debug those modifications.

For UploadFit copies distributed with `lamejs`, the project owner permits a
recipient to reproduce and modify the provided Corresponding Application Code
as needed to replace/relink `lamejs` with a compatible modified build, and to
reverse-engineer the Combined Work for debugging those modifications. This
limited permission does not relicense `lamejs`, which remains under its own
upstream terms, and does not grant unrelated rights in UploadFit.

If a distributor removes this source/relink package or the above permission,
they must remove the encoder from the distributed IIFE or obtain a separate
license. A bare Tabbit share URL without the accompanying stable source and
license location is not an acceptable public release.

## Exact upstream material

- npm package: `lamejs@1.2.1` (exact, not a semver range)
- npm integrity: `sha1-D5LThykhPxBtShne0ggh2n6JyOQ=`
- upstream tag: <https://github.com/zhuker/lamejs/tree/v1.2.1>
- package entry used by the build: `node_modules/lamejs/lame.min.js`
- `lame.min.js` SHA-256:
  `15D285E2587B3BDBFD18A68DE6CE07CC074F7480A82C3815DA2DC1C348EC6DF4`
- UploadFit modification to upstream source: none

## Rebuild with the locked encoder

From a clean release-source checkout using the supported Node/npm versions:

```powershell
npm ci
npm run audio:probe:build
npm run check
```

The S0 probe reads `node_modules/lamejs/lame.min.js` at build time and embeds
it into the main/Worker IIFE. It performs no runtime fetch or dynamic import.

## Replace the encoder for relinking

1. Obtain or build an interface-compatible `lame.min.js` exposing
   `lamejs.Mp3Encoder`.
2. Replace the locked package locally, or replace
   `node_modules/lamejs/lame.min.js` in an installed clean checkout.
3. Record the replacement source, license, version and SHA-256.
4. Run `npm run audio:probe:build` (and, once S2 integrates the codec,
   `npm run build`).
5. Run `npm run check` and the audio codec gates before distribution.

The generated artifact changes when the encoder changes. The replacement must
not reuse the old 200MB evidence or SHA.

## Public-release handoff

S5 must replace any internal-only source location with a stable public source
or release-package location and verify that the prominent IIFE notice points
recipients to it. Until then, the current files authorize engineering and
private Tabbit verification, not publication of a detached script without its
source/license package.
