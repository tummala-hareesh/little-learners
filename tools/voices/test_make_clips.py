"""Tests for make_clips.py (no Kokoro needed: a fake synthesiser stands in for the model).
Run: tools/voices/.venv/bin/pytest tools/voices
"""
import json
import wave

import numpy as np
import pytest

import make_clips as mc

SR_IN = 24000


def tone(seconds=0.4, lead=0.3, tail=0.3, amp=0.3, sr=SR_IN):
    """Silence, a 440 Hz tone, silence: like a TTS clip with padding."""
    t = np.arange(int(seconds * sr)) / sr
    body = amp * np.sin(2 * np.pi * 440 * t)
    return np.concatenate([np.zeros(int(lead * sr)), body, np.zeros(int(tail * sr))]).astype(np.float32)


def fake_synth(calls):
    def synth(text, voice, speed):
        calls.append((text, voice, speed))
        return tone()
    return synth


def read_wav(path):
    with wave.open(str(path)) as w:
        frames = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
        return w.getnchannels(), w.getsampwidth(), w.getframerate(), frames


VOICES = {
    "sample_rate": 22050,
    "girl": {"dir": "audio", "voice": "af_test", "speed": 0.9},
    "boy": {"dir": "audio-m", "voice": "am_test", "speed": 0.9},
    "candidates": {"girl": ["af_a", "af_b"], "boy": ["am_a"]},
}
MANIFEST = {"app": "demo", "clips": {"n-1": "one", "how-many": "How many"}, "samples": [["how-many", "n-1"]]}


@pytest.fixture
def app_dir(tmp_path):
    d = tmp_path / "apps" / "demo"
    d.mkdir(parents=True)
    return d


def test_trim_keeps_short_lead_and_tail():
    x = mc.trim_silence(tone(lead=0.5, tail=0.5), SR_IN)
    lead = np.argmax(np.abs(x) > 0.01) / SR_IN
    assert lead < 0.08
    assert len(x) / SR_IN < 0.4 + 0.08 + 0.15


def test_trim_of_silence_is_empty():
    assert len(mc.trim_silence(np.zeros(SR_IN, dtype=np.float32), SR_IN)) == 0


def test_normalise_sets_peak():
    y = mc.normalise_peak(tone(amp=0.1))
    assert np.max(np.abs(y)) == pytest.approx(10 ** (mc.PEAK_DBFS / 20), rel=1e-3)


def test_resample_length():
    y = mc.resample(np.zeros(24000, dtype=np.float32), 24000, 22050)
    assert len(y) == 22050


def test_make_clips_writes_both_voices_in_the_house_format(app_dir):
    calls = []
    report = mc.make_clips(MANIFEST, VOICES, app_dir, fake_synth(calls))
    assert sorted(report["written"]) == ["audio-m/how-many.wav", "audio-m/n-1.wav", "audio/how-many.wav", "audio/n-1.wav"]
    assert ("one", "af_test", 0.9) in calls and ("one", "am_test", 0.9) in calls
    for f in report["written"]:
        ch, width, rate, frames = read_wav(app_dir / f)
        assert (ch, width, rate) == (1, 2, 22050)
        lead = np.argmax(np.abs(frames) > 300) / rate
        assert lead < 0.08
        assert np.max(np.abs(frames)) > 0.8 * 32767


def test_existing_clips_are_never_overwritten_without_force(app_dir):
    (app_dir / "audio").mkdir()
    keep = app_dir / "audio" / "n-1.wav"
    keep.write_bytes(b"hand recorded")
    calls = []
    report = mc.make_clips(MANIFEST, VOICES, app_dir, fake_synth(calls))
    assert keep.read_bytes() == b"hand recorded"
    assert "audio/n-1.wav" in report["skipped"]
    assert ("one", "af_test", 0.9) not in calls
    report = mc.make_clips(MANIFEST, VOICES, app_dir, fake_synth(calls), force=True)
    assert keep.read_bytes() != b"hand recorded"


def test_only_limits_the_clips(app_dir):
    report = mc.make_clips(MANIFEST, VOICES, app_dir, fake_synth([]), only=["n-1"])
    assert sorted(report["written"]) == ["audio-m/n-1.wav", "audio/n-1.wav"]


def test_only_rejects_unknown_names(app_dir):
    with pytest.raises(SystemExit):
        mc.make_clips(MANIFEST, VOICES, app_dir, fake_synth([]), only=["nope"])


def test_silent_output_is_an_error(app_dir):
    with pytest.raises(RuntimeError):
        mc.make_clips(MANIFEST, VOICES, app_dir, lambda t, v, s: np.zeros(SR_IN, dtype=np.float32))


def test_listen_page_lists_every_clip_and_sample(tmp_path):
    page = tmp_path / "listen.html"
    mc.write_listen_page(MANIFEST, VOICES, page, "../apps/demo")
    html = page.read_text()
    for name in MANIFEST["clips"]:
        assert f'../apps/demo/audio/{name}.wav' in html and f'../apps/demo/audio-m/{name}.wav' in html
    assert "How many one" in html
    assert "http" not in html  # local only, no external requests


def test_audition_renders_every_candidate(tmp_path):
    calls = []
    out = tmp_path / "audition"
    mc.audition(MANIFEST, VOICES, out, fake_synth(calls), count=2)
    assert {c[1] for c in calls} == {"af_a", "af_b", "am_a"}
    assert (out / "af_b" / "n-1.wav").exists()
    assert "af_b/n-1.wav" in (out / "audition.html").read_text()


def test_real_voices_json_is_valid():
    v = json.loads((mc.HERE / "voices.json").read_text())
    assert v["sample_rate"] == 22050
    assert v["girl"]["dir"] == "audio" and v["boy"]["dir"] == "audio-m"
    assert v["girl"]["voice"].startswith(("af_", "bf_")) and v["boy"]["voice"].startswith(("am_", "bm_"))


SKIP_MANIFEST = {"app": "demo", "clips": {"ipa-k": "k", "ipa-ae": "a", "w-ox": "ox", "w-oxen": "oxen"}, "samples": []}


def test_skip_prefix_protects_clips_even_with_force(app_dir):
    for d in ("audio", "audio-m"):
        (app_dir / d).mkdir()
        (app_dir / d / "ipa-k.wav").write_bytes(b"hand recorded")
    before = (app_dir / "audio" / "ipa-k.wav").stat().st_mtime_ns
    calls = []
    report = mc.make_clips(SKIP_MANIFEST, VOICES, app_dir, fake_synth(calls), force=True, skip=["ipa-"])
    for d in ("audio", "audio-m"):
        assert (app_dir / d / "ipa-k.wav").read_bytes() == b"hand recorded"
        assert not (app_dir / d / "ipa-ae.wav").exists()
    assert (app_dir / "audio" / "ipa-k.wav").stat().st_mtime_ns == before
    assert sorted(report["protected"]) == ["audio-m/ipa-ae.wav", "audio-m/ipa-k.wav", "audio/ipa-ae.wav", "audio/ipa-k.wav"]
    assert "audio/w-ox.wav" in report["written"]
    assert report["skipped"] == []
    assert {c[0] for c in calls} == {"ox", "oxen"}
    assert report["skip_matches"] == {"ipa-": 2}


def test_skip_wins_over_only(app_dir):
    report = mc.make_clips(SKIP_MANIFEST, VOICES, app_dir, fake_synth([]), only=["ipa-k", "w-ox"], skip=["ipa-"])
    assert sorted(report["written"]) == ["audio-m/w-ox.wav", "audio/w-ox.wav"]
    assert sorted(report["protected"]) == ["audio-m/ipa-k.wav", "audio/ipa-k.wav"]


def test_skip_exact_name_is_not_a_prefix(app_dir):
    report = mc.make_clips(SKIP_MANIFEST, VOICES, app_dir, fake_synth([]), skip=["w-ox"])
    assert "audio/w-oxen.wav" in report["written"]
    assert "audio/w-ox.wav" in report["protected"] and "audio/w-ox.wav" not in report["written"]
    assert report["skip_matches"] == {"w-ox": 1}


def test_skip_that_matches_nothing_is_reported(app_dir):
    report = mc.make_clips(SKIP_MANIFEST, VOICES, app_dir, fake_synth([]), skip=["s-"])
    assert report["skip_matches"] == {"s-": 0}
    assert report["protected"] == []
    assert len(report["written"]) == 8


def test_summary_line_names_protected_clips():
    report = {"written": ["a"] * 4, "skipped": [], "protected": ["x"] * 2, "skip_matches": {"ipa-": 1}}
    line = mc.summary(report)
    assert "wrote 4 clips" in line
    assert "protected 2 (--skip ipa-: matched 1)" in line
    no_skip = mc.summary({"written": [], "skipped": ["a"], "protected": [], "skip_matches": {}})
    assert "skipped 1 existing (--force to redo)" in no_skip and "protected" not in no_skip


def test_main_accepts_repeatable_skip(monkeypatch, tmp_path):
    seen = {}
    monkeypatch.setattr(mc, "kokoro_synth", lambda: None)
    monkeypatch.setattr(mc, "HERE", tmp_path)
    monkeypatch.setattr(mc, "ROOT", tmp_path)
    (tmp_path / "out" / "demo").mkdir(parents=True)
    (tmp_path / "out" / "demo" / "manifest.json").write_text(json.dumps(SKIP_MANIFEST))
    (tmp_path / "voices.json").write_text(json.dumps(VOICES))

    def fake_make(manifest, voices, app_dir, synth, only=None, force=False, skip=None, log=None):
        seen["skip"], seen["force"] = skip, force
        return {"written": [], "skipped": [], "protected": [], "skip_matches": {p: 0 for p in skip or []}}
    monkeypatch.setattr(mc, "make_clips", fake_make)
    mc.main(["demo", "--force", "--skip", "ipa-", "--skip", "w-ox"])
    assert seen == {"skip": ["ipa-", "w-ox"], "force": True}
