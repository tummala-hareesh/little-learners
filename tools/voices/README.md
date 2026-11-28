# tools/voices: Kokoro voice clips

Makes an app's built-in **girl** (`audio/`) and **boy** (`audio-m/`) clips with
[Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) (Apache-2.0, runs on CPU). Build time only:
nothing in this folder is deployed (`tools/build-site.sh` publishes only `index.html`, `apps/`, `hub/`), and the
apps keep playing plain `.wav` files with no runtime dependencies.

Kokoro has no child voices. "Girl" and "boy" are a bright, friendly female and male voice (`voices.json`).

## Setup (once)

```bash
cd tools/voices
uv venv --python 3.12 .venv          # kokoro does not support Python 3.13 yet
VIRTUAL_ENV=$PWD/.venv uv pip install --index-url https://download.pytorch.org/whl/cpu torch   # CPU build: ~200 MB, not ~3 GB of CUDA
VIRTUAL_ENV=$PWD/.venv uv pip install -r requirements.txt
```

The first run downloads the model (~330 MB) to the Hugging Face cache; after that it runs offline.
For words its dictionary doesn't know, Kokoro can fall back to `espeak-ng` (optional, a dev tool only).

## Make clips for an app

```bash
node tools/voices/manifest.js number-pals              # clip names + text, read from the app itself
tools/voices/.venv/bin/python tools/voices/make_clips.py number-pals
```

- The clip list is `tests/<app>/clips.js` (the same list the content test checks) and the words come from the
  app's `clipText()`, so clips, device-voice text and tests can't drift apart. Change a word in the app, re-run.
- Output: 16-bit PCM mono 22050 Hz, silence trimmed (30 ms lead), peak-normalised to -1 dBFS.
- Existing clips are **skipped**. `--force` redoes them, **including hand recordings**; `--only n-3 p-0` limits the run.
- `--skip` protects clips even with `--force` (repeatable). An argument ending in `-` is a prefix (`--skip ipa-`
  = every `ipa-*` clip); anything else is one exact clip name (`--skip w-ox` keeps `w-ox`, not `w-oxen`).
  If a `--skip` matches no clip in the manifest (a typo such as `--skip ipa` without the dash), the run stops
  **before writing anything** and suggests the prefix. The summary line reports `protected N (--skip ipa-: matched N)`.
- Apps with hand recordings to keep: Word Pictures' phonics sounds are hand-recorded, so regenerate it with
  `make_clips.py word-pictures --force --skip ipa-`, then check `git diff --stat` shows no `ipa-*` changes.
- Listen-through: open `tools/voices/out/<app>/listen.html` (every clip in both voices, plus the sentences the
  game builds from them). Then play a full game in both voices before setting `CLIPS_RECORDED = true`.

Every app and the hub use this generator:

| Target | Command | Notes |
|---|---|---|
| Number Pals, Sign Spotters, Shape Friends | `make_clips.py <app>` (`--force` to redo) | every clip is Kokoro |
| Word Pictures | `make_clips.py word-pictures --force --skip ipa-` | phonics `ipa-*` stay hand-recorded |
| Playroom hub | `node tools/voices/manifest.js hub` → `make_clips.py hub` | `hub/audio{,-m}/app-<id>.wav` say each `APPS[].say`; then remove `clips: false` |

## Picking voices

```bash
tools/voices/.venv/bin/python tools/voices/make_clips.py number-pals --audition
```

renders the first five clips with every `candidates` voice into `out/<app>/audition/audition.html`. Put the
chosen pair in `voices.json` (`girl.voice`, `boy.voice`) and re-run `make_clips.py <app> --force` (add `--skip`
for any hand recordings that app keeps, e.g. `--skip ipa-` for Word Pictures).

## A new app

Add `tests/<app>/clips.js` exporting `TABLES` (the app globals `allClips` reads), `allClips(C)` and optional
`SAMPLES` (clip sequences for the listen page), use it from `tests/<app>/content.spec.js`, then run the two
commands above. Then make its hub name clip: re-run `node tools/voices/manifest.js hub && make_clips.py hub`
(existing name clips are skipped) and drop `clips: false` from its `APPS` entry.

## Tests

```bash
tools/voices/.venv/bin/pytest tools/voices        # fake synthesiser, no model needed
```
