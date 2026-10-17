# Codec replacement and relinking

UploadFit's original application code is MIT licensed. The bundled encoder is
`lamejs@1.2.1` under its own upstream terms (package-declared LGPL-3.0).
Recipients may modify and rebuild the application and encoder, including
reverse-engineering the combined work to debug modifications to the LGPL part.

## Complete distribution

Distribute the same-version application source (`src/`, `scripts/`,
`esbuild.config.js`, `package.json`, `package-lock.json` and `project-page/`),
`dist/uploadfit.user.js` and the optional `dist/uploadfit.js`, `LICENSE`, `NOTICE`, this `licenses/` directory and
`vendor/lamejs-1.2.1.tgz` together. The vendor archive is the unmodified npm
source package and includes the upstream JavaScript sources. Its integrity is
recorded in `provenance.json`. `npm run release` includes these materials in a source ZIP (requires a clean, committed Git checkout).

The source repository is https://github.com/TenrocZ/uploadfit. When distributing
a binary/script, provide its matching complete source package alongside it;
a bare script or a Tabbit share link is not the full distribution. A source
package must remain accessible to recipients even if the repository is private.
Record the source revision and the SHA-256 of the distributed script in the
release notes or accompanying checksum file.

## Rebuild the locked version

Using Node.js 22.20.0+ and npm 10.9.3+ in the complete source directory:

```sh
npm ci
npm run check
```

The build reads `node_modules/lamejs/lame.min.js` and embeds it in a local Blob
Worker. There is no runtime download of the encoder. `npm ci` needs registry
access for build dependencies; the original encoder source is also bundled in
`vendor/` for preservation and modification.

## Replace the encoder

1. Extract `vendor/lamejs-1.2.1.tgz`, modify its upstream source, and produce a
   compatible `lame.min.js` exposing `lamejs.Mp3Encoder`. The package includes
   its upstream build files and JavaScript source under `src/js/`.
2. Run `npm ci`, then replace `node_modules/lamejs/lame.min.js` with your build.
   Do not rerun `npm ci` after replacement; it would restore the locked version.
3. If your API or rate behavior changes, adapt `src/audio/encoder.js`,
   `src/audio/worker-adapter.js` and `src/audio/encoder-contract.js` as needed.
4. Run `npm run check`. The build has no hash gate preventing a modified encoder.
5. Verify real encoding, output properties, cancellation and cleanup in the
   target browser. Static checks alone cannot validate codec correctness.
6. Ship your modified encoder source, retain upstream license/attribution,
   update provenance and modification notices, and compute new script hashes.

UploadFit's build replaces two inert upstream URL strings with
`embedded://lamejs`, strips trailing whitespace and bundles/minifies the code.
The vendor source archive itself is unmodified. These transformations are
visible in `esbuild.config.js` and do not fetch remote code.
