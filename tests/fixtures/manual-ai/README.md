# Manual AI Test Images

These files are synthetic fixtures for manual UploadFit browser testing. The
portrait depicts a fictional person and contains no real identity data.

| File | Intended test |
| --- | --- |
| `portrait-valid-358x441-9-20kb.jpg` | Already-valid Haidian-style 358 x 441 JPG in the 9-20 KB range |
| `portrait-valid-390x567-30-120kb.jpg` | Already-valid CNIPA-style 390 x 567 JPG in the 30-120 KB range |
| `portrait-invalid-800x1200-large.jpg` | Portrait that requires crop, resize, and compression |
| `landscape-1600x900-high-detail.jpg` | Strong aspect-ratio mismatch and high-detail compression input |
| `stilllife-1024x1024.jpg` | Square JPEG format and crop test |
| `stilllife-1024x1024.png` | Square PNG-to-JPEG/size-reduction test |
| `stilllife-invalid-64x64.jpg` | Deliberately undersized image |
| `source-*.png` | Original AI-generated sources for further manual variants |

Do not submit these images to a real government form. File selection without
submission is sufficient for rule parsing and refill checks.

Generation method: OpenAI built-in image generation, followed by deterministic
local crop/resize/JPEG encoding with Windows `System.Drawing`.

The final generation prompts are recorded in `PROMPTS.md`.
