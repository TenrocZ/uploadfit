# UploadFit · 传送门

**Adapt images and audio to upload requirements, locally in your browser.**

[简体中文](README.md) · [Installable script](dist/uploadfit.js) · [Issues](https://github.com/TenrocZ/uploadfit/issues) · [MIT](LICENSE)

UploadFit is a JavaScript tool for **Tabbit Browser's script skills**. It reads upload constraints from the page, adapts a selected file when the rules are actionable, validates the result and puts it back into the upload input. It asks for confirmation where required and does not click the website's final submit button. Version **0.1.0** is an early release; website compatibility varies. This is an independent project, not an official Tabbit product.

## Features

- JPEG, PNG and WebP: resize, compress, convert and fix orientation; confirm cropping, upscaling or transparency changes when required.
- MP3: re-encode to a supported bitrate to meet a size limit.
- PCM WAV and supported non-encrypted, non-fragmented AAC-LC M4A: convert to MP3 only when the page explicitly permits it.
- Preserve files that already comply; stop when rules conflict or output validation fails.
- Discover dynamic upload inputs, show rule evidence and allow cancellation.

## Installation

1. Download the complete repository source package or clone it.
2. Copy the entire contents of `dist/uploadfit.js` into a Tabbit script skill.
3. Restrict the skill to the intended websites, save, enable it and reload the page.
4. Select a file normally; review any proposed changes and confirm when prompted.
5. Review the result and complete the website's submission yourself.

To update, replace the saved script with the new production file. To disable, turn off the skill and reload. Do not paste Markdown fences or source ESM modules. When redistributing the script, include its corresponding buildable source and license materials.

## Privacy and limitations

Media processing happens in browser memory. When local parsing is insufficient, Tabbit's `LLMBridge.chat()` may send filtered, sanitized, length-limited rule text to its online AI service. UploadFit does not attach media, filenames or the full page to that request. Suspicious input and invalid AI responses are rejected. No project API key is required.

The destination website may automatically upload a file when it is selected or filled back in. Local adaptation does not prevent that website from receiving it. Enable UploadFit only on websites you trust.

MP3/M4A transcoding requires WebCodecs support inside a Worker. CSP, browser versions and device limits can prevent processing. Images are limited to 50 MiB and 80 million decoded pixels. Multiple-file batches, audio trimming, denoising, video extraction, encrypted media and arbitrary M4A variants are unsupported. Compression cannot solve a duration limit. UploadFit does not bypass authentication, server validation or quotas.

## Build

Requires Node.js 22.20.0+ and npm 10.9.3+.

```sh
git clone https://github.com/TenrocZ/uploadfit.git
cd uploadfit
npm ci
npm run check
```

`npm run build` builds the production IIFE and synchronizes the project page. `npm run check` also checks static runtime restrictions, license materials and release consistency; it is not a browser test suite. `npm run release` creates a complete source ZIP, revision record and SHA-256 checksums under `release/`, from a clean, committed Git checkout. It does not upload or publish anything.

`src/` contains runtime code; `scripts/` contains build/release tooling; `dist/` contains the installable script; `project-page/` contains the product page. Third-party notices are in `licenses/`, and the original encoder source archive is in `vendor/`. Internal development documents, tests, fixtures and probes are excluded from the public tree.

## Contributing and licenses

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) and [CHANGELOG.md](CHANGELOG.md).

Original UploadFit code is [MIT licensed](LICENSE). Bundled `lamejs@1.2.1` retains its upstream terms (npm declares LGPL-3.0); MIT does not relicense third-party code. Preserve [NOTICE](NOTICE), `licenses/`, the source archive and buildable application source. See [third-party notices](licenses/NOTICE.md) and [replacement/relinking instructions](licenses/RELINKING.md).
