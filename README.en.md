# UploadFit · 传送门

**A cross-browser userscript that adapts images and audio to upload requirements locally.**

[简体中文](README.md) · [Install userscript](https://raw.githubusercontent.com/TenrocZ/uploadfit/main/dist/uploadfit.user.js) · [Complete source](https://github.com/TenrocZ/uploadfit/archive/refs/heads/main.zip) · [Issues](https://github.com/TenrocZ/uploadfit/issues)

Version **0.2.0** runs through Tampermonkey or Violentmonkey in modern browsers. The universal version uses local rules and needs no Tabbit installation, AI account or API key. Tabbit AI remains an optional, separate distribution.

## Install

1. Install **one** userscript manager:

| Browser | Official Tampermonkey entry | Alternative |
| --- | --- | --- |
| Chrome, Brave, Vivaldi, Opera and other Chromium browsers | [Chrome Web Store](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo) | [Violentmonkey](https://violentmonkey.github.io/get-it/) |
| Edge | [Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/iikmkjmpaadaobahmlepeloendndfphd) | [Violentmonkey](https://violentmonkey.github.io/get-it/) |
| Firefox | [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/tampermonkey/) | [Violentmonkey](https://violentmonkey.github.io/get-it/) |
| Safari | [Official Safari entry](https://www.tampermonkey.net/index.php?browser=safari) | Availability and pricing depend on the App Store |

On Chromium, enable **Allow User Scripts** in the extension details when required; versions without that switch may require Developer Mode. See the [official permission guide](https://www.tampermonkey.net/faq.php?q=Q209). On Safari, enable the extension and grant access to the intended websites.

2. Open [uploadfit.user.js](https://raw.githubusercontent.com/TenrocZ/uploadfit/main/dist/uploadfit.user.js) and confirm installation in the manager. If it shows plain code, is inaccessible, or the repository is private, obtain the source ZIP or [`dist/uploadfit.user.js`](dist/uploadfit.user.js). Create a new script in the manager, replace its default template with the **entire file including its `// ==UserScript==` header**, save and enable it. Do not install `uploadfit.meta.js` alone.
3. Allow access to the target website, reload it and select a file. Review any proposed changes, confirm when prompted, inspect the result and submit the website's form yourself. If filling the input is unavailable, download the result and select it manually.

The direct-install and update URLs target `main`; they require the userscript to be merged there and publicly accessible. Use manual installation while reviewing a private branch. Never put a repository token into the script.

The script starts on ordinary HTTP/HTTPS **top-level pages**, excluding browser internal pages, extension stores and PDF viewers. It does not start separate instances in frames; the top-level instance can discover some same-origin framed inputs. Limit sites using the manager's user match/exclude rules or browser site permissions. Do not enable multiple copies.

## What works where

- JPEG, PNG and WebP: resize, compress, convert and fix orientation using standard Canvas/File/Blob APIs. Output encoders vary by browser. Cropping, upscaling and transparency changes request confirmation when needed.
- PCM WAV to MP3: requires Blob Workers. PCM input decoding is local, but final MP3 output verification still requires an MP3 WebCodecs decoder in a Worker.
- MP3 or supported non-encrypted, non-fragmented AAC-LC M4A to MP3: requires the corresponding **WebCodecs decoder inside a Worker**, usually on HTTPS. Codec availability depends on the browser and OS.
- Files already compliant with actionable rules are kept unchanged.

Desktop Chrome, Edge, Firefox and other Chromium browsers are primary targets. Safari can be tried with its manager, but manager availability is not a promise of every media feature. CSP and device limits can stop execution. Mobile extension behavior is not part of this release's device validation. Unsupported operations stop rather than upload files to a conversion service.

Images are limited to 50 MiB and 80 million decoded pixels. Multiple-file batches, audio trimming/denoising, video extraction, encrypted media and arbitrary M4A variants are unsupported. Compression cannot solve a duration limit. Custom inputs, cross-origin frames, closed Shadow DOM and websites rejecting synthetic events may prevent filling. Server validation and access controls are never bypassed.

Version 0.2.0 was checked on Chromium, Firefox and Windows WebKit for images, reinjection and startup lifecycle, with an actual Tampermonkey import and automatic-injection check on Chromium. WAV-to-MP3 passed on Chromium/Firefox. The tested Windows WebKit lacks the output-verification decoder and stops while preserving the original file. WebKit automation is not Safari extension device validation.

## Privacy and optional Tabbit AI

`uploadfit.user.js` is **local-rule-only**. It does not call AI, load CDN dependencies or request privileged network APIs. It runs in the page context with `@grant none`. Your userscript manager has its own privacy and update behavior.

Tabbit users may instead paste [`dist/uploadfit.js`](dist/uploadfit.js) into a Tabbit script skill, restrict the websites and reload. Disable the universal copy first. Only this optional build can send filtered rule text through Tabbit's `LLMBridge.chat()` online service; media, filenames and the full page are not attached. AI responses require local validation.

Both distributions process media in browser memory. The destination website may automatically upload on selection or after a fill event. Local adaptation does not prevent that site receiving files. See [SECURITY.md](SECURITY.md).

## Update and troubleshoot

- Public URL installations can update through the manager. If automatic updates are unavailable, replace the existing script with the full new version and reload. Keep only one enabled copy.
- Disable/delete UploadFit in the manager and reload to stop it. Closing its page UI stops only that page session.
- If nothing appears, check script execution permission, site access and enabled status, then reload a normal page. Strict CSP can block the script or Workers.
- Missing AI is normal in the universal build. Missing or conflicting rules stop adaptation.
- For unsupported audio, check HTTPS, the exact format and Worker codec support; try an updated Chromium browser or convert manually.

## Build and distribute

Requires Node.js 22.20.0+ and npm 10.9.3+.

```sh
git clone https://github.com/TenrocZ/uploadfit.git
cd uploadfit
npm ci
npm run check
```

`npm run build` produces `dist/uploadfit.user.js`, update metadata `dist/uploadfit.meta.js`, the optional Tabbit `dist/uploadfit.js` and synchronized project-page files. `npm run check` verifies static runtime restrictions, metadata, licenses and artifact consistency; it is not a browser test suite. `npm run release` packages a clean, committed Git checkout with complete source, lockfile, vendor source, licenses and checksums without publishing it.

See [CONTRIBUTING.md](CONTRIBUTING.md), [CHANGELOG.md](CHANGELOG.md) and [codec replacement instructions](licenses/RELINKING.md). Internal tests and development records are not included in the public tree.

Original code is [MIT licensed](LICENSE). Bundled `lamejs@1.2.1` retains its upstream terms (npm declares LGPL-3.0). Preserve [NOTICE](NOTICE), `licenses/`, buildable source and `vendor/` when redistributing. This is an independent project with no official affiliation to the browsers or managers named above.
