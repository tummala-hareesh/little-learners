#!/usr/bin/env python3
"""Make an app's girl/boy voice clips with Kokoro (build time only; nothing here is deployed).

    node tools/voices/manifest.js <app>                 # clip names + text, from the app itself
    tools/voices/.venv/bin/python tools/voices/make_clips.py <app> [--only NAME ...] [--force] [--skip PREFIX|NAME ...]
    tools/voices/.venv/bin/python tools/voices/make_clips.py <app> --audition   # compare voices by ear

Writes apps/<app>/audio/<name>.wav (girl) and apps/<app>/audio-m/<name>.wav (boy) as 16-bit PCM mono
22050 Hz, trimmed and peak-normalised, plus tools/voices/out/<app>/listen.html to hear every clip and the
sentences the game builds from them. Existing clips are skipped unless --force. --force rewrites them, so
protect hand recordings with --skip (e.g. --force --skip ipa- keeps Word Pictures' phonics clips).
See tools/voices/README.md for setup.
"""
import argparse
import html
import json
import sys
import wave
from math import gcd
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
KOKORO_SR = 24000
PEAK_DBFS = -1.0
LEAD_MS = 30
TAIL_MS = 60
SILENCE_DB = -40.0


def trim_silence(x, sr, threshold_db=SILENCE_DB, lead_ms=LEAD_MS, tail_ms=TAIL_MS):
    """Cut leading/trailing silence, keeping a short pad. All-silent input gives an empty array."""
    x = np.asarray(x, dtype=np.float32)
    peak = float(np.max(np.abs(x))) if len(x) else 0.0
    if peak == 0.0:
        return x[:0]
    loud = np.nonzero(np.abs(x) > peak * 10 ** (threshold_db / 20))[0]
    start = max(0, loud[0] - int(sr * lead_ms / 1000))
    end = min(len(x), loud[-1] + 1 + int(sr * tail_ms / 1000))
    return x[start:end]


def normalise_peak(x, peak_dbfs=PEAK_DBFS):
    peak = float(np.max(np.abs(x))) if len(x) else 0.0
    return x if peak == 0.0 else (x * (10 ** (peak_dbfs / 20) / peak)).astype(np.float32)


def resample(x, sr_in, sr_out):
    if sr_in == sr_out:
        return x
    from scipy.signal import resample_poly
    g = gcd(sr_in, sr_out)
    return resample_poly(x, sr_out // g, sr_in // g).astype(np.float32)


def write_wav(path, x, sr):
    path.parent.mkdir(parents=True, exist_ok=True)
    pcm = (np.clip(x, -1.0, 1.0) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())


def render(synth, text, voice, speed, sr_out):
    """Text → finished clip samples at sr_out."""
    x = trim_silence(synth(text, voice, speed), KOKORO_SR)
    if len(x) == 0:
        raise RuntimeError(f"{voice} produced silence for {text!r}")
    # Resample before normalising so the final peak is exact.
    return normalise_peak(resample(x, KOKORO_SR, sr_out))


def skip_match(name, arg):
    """--skip ARG: ending in "-" is a prefix (ipa-), anything else is one exact clip name (w-ox, not w-oxen)."""
    return name.startswith(arg) if arg.endswith("-") else name == arg


def make_clips(manifest, voices, app_dir, synth, only=None, force=False, skip=None, log=lambda s: None):
    """Write every manifest clip in both voices under app_dir.

    Returns {"written", "skipped" (already existed), "protected" (left alone by --skip, even with --force),
    "skip_matches" ({skip arg: number of manifest clips it matches})}. Exits before writing anything if a
    --skip arg is malformed or matches no clip in the manifest.
    """
    clips = manifest["clips"]
    names = list(clips)
    if only:
        unknown = [n for n in only if n not in clips]
        if unknown:
            sys.exit(f"make_clips: not in the manifest: {', '.join(unknown)}")
        names = [n for n in names if n in only]
    skip = [a.strip() for a in (skip or [])]
    bad = [a for a in skip if not a.strip("-") or "*" in a or " " in a]
    if bad:
        sys.exit(f"make_clips: --skip needs a clip name or a prefix like ipa- (no * or spaces), not {bad!r}")
    # Count matches over the whole manifest (not just --only), and refuse to write anything if a --skip
    # matches no clip: a typo like "--skip ipa" must not let --force overwrite the clips it meant to keep.
    skip_matches = {arg: sum(skip_match(n, arg) for n in clips) for arg in skip}
    unmatched = [a for a, n in skip_matches.items() if n == 0]
    if unmatched:
        hints = [f"{a} (did you mean {a}-?)" if any(n.startswith(a + "-") for n in clips) else a for a in unmatched]
        sys.exit(f"make_clips: --skip matches no clip, nothing written: {', '.join(hints)}")
    protected = {n for n in names if any(skip_match(n, arg) for arg in skip)}
    report = {"written": [], "skipped": [], "protected": [], "skip_matches": skip_matches}
    for who in ("girl", "boy"):
        v = voices[who]
        for name in names:
            rel = f"{v['dir']}/{name}.wav"
            path = Path(app_dir) / rel
            if name in protected:
                report["protected"].append(rel)
                continue
            if path.exists() and not force:
                report["skipped"].append(rel)
                continue
            write_wav(path, render(synth, clips[name], v["voice"], v["speed"], voices["sample_rate"]), voices["sample_rate"])
            report["written"].append(rel)
            log(f"  {rel}: {clips[name]}")
    return report


def clip_dir(manifest, root):
    """Where an app's audio/ and audio-m/ live: manifest "dir" (e.g. "hub"), default apps/<app>. Stays under root."""
    rel = manifest.get("dir", f"apps/{manifest['app']}")
    if not rel.strip() or rel.startswith("/") or ".." in Path(rel).parts:
        sys.exit(f"make_clips: bad clip dir in manifest: {rel!r}")
    return Path(root) / rel


def summary(report):
    """One line for the end of a run."""
    line = f"wrote {len(report['written'])} clips, skipped {len(report['skipped'])} existing (--force to redo)"
    if report.get("skip_matches"):
        matched = ", ".join(f"--skip {a}: matched {n}" for a, n in report["skip_matches"].items())
        line += f", protected {len(report['protected'])} ({matched})"
    return line


PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<style>
body {{ font: 18px system-ui, sans-serif; margin: 16px; max-width: 900px; }}
table {{ border-collapse: collapse; width: 100%; }} td, th {{ padding: 6px; border-bottom: 1px solid #ddd; text-align: left; }}
button {{ min-width: 44px; min-height: 44px; font-size: 18px; }}
</style></head><body>
<h1>{title}</h1>
<p>{intro}</p>
{body}
<script>
// Play a list of clips one after another (the same way the game joins fragments).
function play(srcs) {{
  const list = srcs.slice();
  const next = () => {{ const s = list.shift(); if (!s) return; const a = new Audio(s); a.onended = next; a.onerror = next; a.play(); }};
  next();
}}
</script>
</body></html>
"""


def _button(label, srcs):
    return f"<button onclick='play({html.escape(json.dumps(srcs), quote=True)})'>{html.escape(label)}</button>"


def write_listen_page(manifest, voices, out_path, clip_root):
    """Local page to hear every clip and sample sentence in both voices. clip_root is relative to out_path."""
    dirs = {who: f"{clip_root}/{voices[who]['dir']}" for who in ("girl", "boy")}
    clips = manifest["clips"]
    rows = ["<h2>Sentences the game builds</h2><table><tr><th>Sentence</th><th>Girl</th><th>Boy</th></tr>"]
    for sample in manifest.get("samples", []):
        text = " ".join(clips[n].rstrip("!?.") for n in sample)
        rows.append(f"<tr><td>{html.escape(text)}</td>"
                    + "".join(f"<td>{_button('▶', [f'{dirs[w]}/{n}.wav' for n in sample])}</td>" for w in ("girl", "boy"))
                    + "</tr>")
    rows.append("</table><h2>Every clip</h2><table><tr><th>Clip</th><th>Says</th><th>Girl</th><th>Boy</th></tr>")
    for name, text in clips.items():
        rows.append(f"<tr><td>{html.escape(name)}</td><td>{html.escape(text)}</td>"
                    + "".join(f"<td>{_button('▶', [f'{dirs[w]}/{name}.wav'])}</td>" for w in ("girl", "boy"))
                    + "</tr>")
    rows.append("</table>")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(PAGE.format(
        title=f"Listen: {html.escape(manifest['app'])}",
        intro=f"Girl = {html.escape(voices['girl']['voice'])}, boy = {html.escape(voices['boy']['voice'])}. "
              "Tap ▶ to hear each clip; the sentences play their clips back to back like the game does.",
        body="\n".join(rows)))


def audition(manifest, voices, out_dir, synth, count=5):
    """Render the first `count` clips with every candidate voice and a page to compare them."""
    names = list(manifest["clips"])[:count]
    cands = [v for who in ("girl", "boy") for v in voices["candidates"][who]]
    for voice in cands:
        for name in names:
            write_wav(Path(out_dir) / voice / f"{name}.wav",
                      render(synth, manifest["clips"][name], voice, voices["girl"]["speed"], voices["sample_rate"]),
                      voices["sample_rate"])
    head = "".join(f"<th>{html.escape(v)}</th>" for v in cands)
    rows = [f"<table><tr><th>Says</th>{head}</tr>"]
    for name in names:
        rows.append(f"<tr><td>{html.escape(manifest['clips'][name])}</td>"
                    + "".join(f"<td>{_button('▶', [f'{v}/{name}.wav'])}</td>" for v in cands) + "</tr>")
    rows.append("</table>")
    Path(out_dir).mkdir(parents=True, exist_ok=True)
    (Path(out_dir) / "audition.html").write_text(PAGE.format(
        title=f"Voice audition: {html.escape(manifest['app'])}",
        intro="Pick one girl and one boy voice, put them in tools/voices/voices.json, then re-run with --force.",
        body="\n".join(rows)))


def kokoro_synth():
    """Real synthesiser: Kokoro-82M, American English, on CPU. Model is fetched once to the HF cache."""
    from kokoro import KPipeline
    pipe = KPipeline(lang_code="a", repo_id="hexgrad/Kokoro-82M")

    def synth(text, voice, speed):
        parts = [np.asarray(audio, dtype=np.float32) for _, _, audio in pipe(text, voice=voice, speed=speed)]
        return np.concatenate(parts) if parts else np.zeros(0, dtype=np.float32)
    return synth


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("app")
    ap.add_argument("--only", nargs="+", metavar="NAME", help="only these clip names")
    ap.add_argument("--force", action="store_true", help="overwrite existing clips")
    ap.add_argument("--skip", action="append", metavar="PREFIX|NAME",
                    help="never touch these clips, even with --force (repeatable). 'ipa-' = every clip starting "
                         "with ipa-; 'w-ox' = exactly that clip")
    ap.add_argument("--audition", action="store_true", help="render candidate voices to compare instead")
    a = ap.parse_args(argv)
    out = HERE / "out" / a.app
    mpath = out / "manifest.json"
    if not mpath.exists():
        sys.exit(f"make_clips: no manifest; run: node tools/voices/manifest.js {a.app}")
    manifest = json.loads(mpath.read_text())
    voices = json.loads((HERE / "voices.json").read_text())
    synth = kokoro_synth()
    if a.audition:
        audition(manifest, voices, out / "audition", synth)
        print(f"open {out / 'audition' / 'audition.html'}")
        return
    app_dir = clip_dir(manifest, ROOT)
    report = make_clips(manifest, voices, app_dir, synth, only=a.only, force=a.force, skip=a.skip,
                        log=lambda s: print(s, flush=True))
    write_listen_page(manifest, voices, out / "listen.html", "../../../../" + app_dir.relative_to(ROOT).as_posix())
    print(f"{summary(report)}; listen: {out / 'listen.html'}")


if __name__ == "__main__":
    main()
