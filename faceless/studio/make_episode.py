#!/usr/bin/env python3
"""Make one episode of a faceless AI series, end to end, then grade it.

  python3 faceless/studio/make_episode.py faceless/series/squeezed/part-02.json [--stop-after stills] [--redo n03,d02]

Steps (each is cached, so a re-run only redoes what is missing or listed in --redo):
  1. rules     no cussing, never the Lord's name in vain, long enough to run past 1 minute
  2. cast      a reference picture for any character that does not have one yet
  3. voices    narrator and every character in their own voice, with word timings
  4. stills    one 9:16 picture per line, built from the character reference pictures
  5. clips     narrator lines come alive (Kling); character lines become lip-synced close-ups (Kling avatar)
  6. assemble  every shot cut to its line, one-word captions low on screen, hook, part tag -> 1080x1920 MP4
  7. critique  watch every frame: frozen shots, still mouths, length, size, loudness; grade each shot /10
Look at review_stills.jpg before the clips step (pictures are cheap to redo) and review.jpg at the end;
--redo any shot with a wrong face, an extra character, or text in the picture. Loop until PASS.
"""
import argparse, base64, concurrent.futures as cf, io, json, os, re, shutil, subprocess, sys
import numpy as np
import requests
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fal import data_uri, run as fal_run  # noqa: E402

STEPS = ["rules", "cast", "voices", "stills", "clips", "assemble", "critique"]
ap = argparse.ArgumentParser()
ap.add_argument("episode")
ap.add_argument("--stop-after", choices=STEPS)
ap.add_argument("--redo", default="", help="comma-separated line ids whose picture and clip are made again")
ap.add_argument("--redo-clip", default="", help="comma-separated line ids whose clip only is made again")
ap.add_argument("--workers", type=int, default=8)
A = ap.parse_args()

EP = json.load(open(A.episode))
SDIR = os.path.dirname(os.path.abspath(A.episode))
CAST = json.load(open(os.path.join(SDIR, "cast.json")))
CH = CAST["characters"]
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
NAME = f"{CAST['series'].lower()}-part-{int(EP['part']):02d}"
OUT = os.path.join(ROOT, "out", NAME)
for d in ("audio", "stills", "clips", "seg"):
    os.makedirs(os.path.join(OUT, d), exist_ok=True)
P = lambda *x: os.path.join(OUT, *x)
LINES = EP["lines"]
GAP = {"narrator": 0.22, "character": 0.35}


def say(*m):
    print(*m, flush=True)


def stop(step):
    if A.stop_after == step:
        say(f"stopped after {step}")
        sys.exit(0)


def font(size, bold=True):
    for f in ["/usr/share/fonts/opentype/inter/Inter-SemiBold.otf" if bold else "/usr/share/fonts/opentype/inter/Inter-Regular.otf",
              "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]:
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


for i in filter(None, A.redo.split(",")):
    for f in os.listdir(P("stills")) + os.listdir(P("clips")):
        if f.split(".")[0] == i:
            for d in ("stills", "clips"):
                if os.path.exists(P(d, f)):
                    os.remove(P(d, f))
for i in filter(None, A.redo_clip.split(",")):
    for f in os.listdir(P("clips")):
        if f.split(".")[0] == i:
            os.remove(P("clips", f))

# ---------------------------------------------------------------- 1. rules
BANNED = re.compile(r"\b(god|gods|jesus|christ|lord|omg|oh\s+my\s+god|damn|dang|darn|hell|heck|crap|shit\w*|fuck\w*|bitch\w*|"
                    r"ass|asses|bastard\w*|piss\w*|freaking|frick\w*|sucks?)\b", re.I)
texts = [(l["id"], l["text"]) for l in LINES] + [("hook", EP.get("hook", "")), ("caption", EP.get("caption", "")), ("title", EP.get("title", ""))]
bad = [(i, m.group(0)) for i, t in texts for m in BANNED.finditer(t or "")]
if bad:
    sys.exit("RULES: remove these words first: " + ", ".join(f"{i}: '{w}'" for i, w in bad))
for l in LINES:
    if l["who"] != "narrator" and l["who"] not in CH:
        sys.exit(f"RULES: line {l['id']} is spoken by '{l['who']}', who is not in cast.json")
words = sum(len(l["text"].split()) for l in LINES)
say(f"rules ok · {len(LINES)} lines · {words} words")
if words < 170:
    say("warning: under 170 words, the video may end before 1 minute and not get paid")
stop("rules")

# ---------------------------------------------------------------- 2. cast
used = {l["who"] for l in LINES if l["who"] != "narrator"} | {c for l in LINES for c in l.get("shot", {}).get("cast", [])}
for k in sorted(used):
    if k not in CH:
        sys.exit(f"cast: '{k}' is not in cast.json")
    ref = os.path.join(SDIR, CH[k]["ref"])
    if not os.path.exists(ref):
        say(f"cast: making a reference picture for {CH[k]['name']}")
        f = fal_run("fal-ai/nano-banana", {"prompt": CAST["style"] + " Character design reference, full body standing, facing camera, "
                    "neutral light gray studio background, soft studio lighting. " + CH[k]["name"].upper() + ": " + CH[k]["desc"] + ".",
                    "num_images": 1, "aspect_ratio": "3:4", "output_format": "png"}, P("stills", "_ref_" + k))[0]
        im = Image.open(f).convert("RGB"); im.thumbnail((900, 1200)); os.makedirs(os.path.dirname(ref), exist_ok=True)
        im.save(ref, quality=90)
        say(f"cast: saved {ref}  (commit it so this character looks the same in every episode)")
stop("cast")

# ---------------------------------------------------------------- 3. voices
def voice(l):
    mp3, js = P("audio", l["id"] + ".mp3"), P("audio", l["id"] + ".json")
    if os.path.exists(mp3) and os.path.exists(js):
        return
    v = CAST["narrator"] if l["who"] == "narrator" else CH[l["who"]]
    r = requests.post(f"https://api.elevenlabs.io/v1/text-to-speech/{v['voice']}/with-timestamps?output_format=mp3_44100_128",
                      headers={"xi-api-key": "proxy-injected"}, timeout=180,
                      json={"text": l["text"], "model_id": "eleven_multilingual_v2", "voice_settings": v.get("settings", {})})
    if r.status_code != 200:
        raise RuntimeError(f"voice {l['id']}: {r.status_code} {r.text[:300]}")
    j = r.json()
    open(mp3, "wb").write(base64.b64decode(j["audio_base64"]))
    json.dump(j["alignment"], open(js, "w"))

with cf.ThreadPoolExecutor(4) as ex:
    list(ex.map(voice, LINES))
ADUR = {l["id"]: json.load(open(P("audio", l["id"] + ".json")))["character_end_times_seconds"][-1] for l in LINES}
SLOT = {l["id"]: ADUR[l["id"]] + (GAP["narrator"] if l["who"] == "narrator" else GAP["character"]) for l in LINES}
say(f"voices ok · {sum(SLOT.values()):.1f} s")
stop("voices")

# ---------------------------------------------------------------- 4. stills
def crop916(src, dst):
    im = Image.open(src).convert("RGB"); w, h = im.size; g = np.asarray(im.convert("L"), dtype=np.float32).mean(axis=1)
    rows = np.where(g > 18)[0]; top, bot = (rows[0], rows[-1]) if len(rows) else (0, h - 1)
    im = im.crop((0, top, w, bot + 1)); w, h = im.size
    tw = min(w, int(h * 9 / 16)); th = int(tw * 16 / 9)
    im.crop(((w - tw) // 2, (h - th) // 2, (w - tw) // 2 + tw, (h - th) // 2 + th)).resize((720, 1280), Image.LANCZOS).save(dst, quality=92)


def still(l):
    jpg = P("stills", l["id"] + ".jpg")
    if os.path.exists(jpg):
        return
    shot = l.get("shot", {})
    who = [] if l["who"] == "narrator" else [l["who"]]
    cast = who or shot.get("cast", [])
    people = " ".join(f"{CH[c]['name'].upper()}: {CH[c]['desc']}." for c in cast)
    if who:
        prompt = f"{CAST['style']} {CAST['closeup']} {people} {shot.get('scene', '')} {CAST['keep']}"
    else:
        prompt = f"{CAST['style']} {shot.get('scene', '')} {('Characters: ' + people) if people else ''} {CAST['keep']}"
    args = {"prompt": prompt, "num_images": 1, "aspect_ratio": "9:16", "output_format": "png"}
    if cast:
        args["image_urls"] = [data_uri(os.path.join(SDIR, CH[c]["ref"])) for c in cast]
        f = fal_run("fal-ai/nano-banana/edit", args, P("stills", l["id"] + "_raw"))[0]
    else:
        f = fal_run("fal-ai/nano-banana", args, P("stills", l["id"] + "_raw"))[0]
    crop916(f, jpg)


def sheet(items, path, cols=8, tw=180, th=320):
    rows = (len(items) + cols - 1) // cols
    S = Image.new("RGB", (cols * tw, rows * (th + 44)), (18, 18, 20)); d = ImageDraw.Draw(S)
    for k, (img, label, col) in enumerate(items):
        x, y = (k % cols) * tw, (k // cols) * (th + 44)
        S.paste(img.resize((tw, th)), (x, y))
        d.text((x + 6, y + th + 4), label, fill=col, font=font(15))
    S.save(path, quality=88)


def safe(fn, l):
    try:
        fn(l)
        return None
    except Exception as e:
        return f"{l['id']}: {e}"


with cf.ThreadPoolExecutor(A.workers) as ex:
    errs = [e for e in ex.map(lambda l: safe(still, l), LINES) if e]
if errs:
    sys.exit("stills failed:\n  " + "\n  ".join(errs))
sheet([(Image.open(P("stills", l["id"] + ".jpg")), f"{l['id']} {l['who']}", (230, 230, 230)) for l in LINES], P("review_stills.jpg"))
say(f"stills ok · look at {P('review_stills.jpg')}")
stop("stills")

# ---------------------------------------------------------------- 5. clips
def clip(l):
    mp4 = P("clips", l["id"] + ".mp4")
    if os.path.exists(mp4):
        return
    shot = l.get("shot", {})
    img = data_uri(P("stills", l["id"] + ".jpg"))
    if l["who"] == "narrator":
        args = {"prompt": "Pixar 3D animation. " + shot.get("motion", "Subtle natural movement, slow cinematic push-in.") +
                " Natural subtle motion, keep faces and characters consistent.", "image_url": img,
                "duration": "10" if SLOT[l["id"]] > 5.3 else "5",
                "negative_prompt": "blur, distort, low quality, morphing faces, extra characters, text, watermark"}
        f = fal_run("fal-ai/kling-video/v2.1/standard/image-to-video", args, P("clips", l["id"]))[0]
    else:
        args = {"image_url": img, "audio_url": data_uri(P("audio", l["id"] + ".mp3")),
                "prompt": "Pixar 3D animated character speaking, natural lip sync, " + shot.get("motion", "expressive face, subtle head movement")}
        f = fal_run("fal-ai/kling-video/ai-avatar/v2/standard", args, P("clips", l["id"]))[0]
    if f != mp4:
        shutil.move(f, mp4)


todo = [l for l in LINES if not os.path.exists(P("clips", l["id"] + ".mp4"))]
say(f"clips: making {len(todo)} (about 3 minutes)")
with cf.ThreadPoolExecutor(A.workers) as ex:
    errs = [e for e in ex.map(lambda l: safe(clip, l), todo) if e]
if errs:
    sys.exit("clips failed:\n  " + "\n  ".join(errs))
stop("clips")

# ---------------------------------------------------------------- 6. assemble
def probe(f):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]))


def ff(*x):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *x], check=True)


VF = "fps=30,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1"
vl, al, starts, t = [], [], {}, 0.0
for l in LINES:
    i, d = l["id"], SLOT[l["id"]]
    src = P("clips", i + ".mp4")
    if l["who"] == "narrator":
        slow = min(max(d / (probe(src) - 0.05), 1.0), 1.6)
        vf = f"setpts={slow:.4f}*PTS,{VF},tpad=stop_mode=clone:stop_duration=8"
    else:
        vf = f"{VF},tpad=stop_mode=clone:stop_duration=4"
    ff("-i", src, "-an", "-vf", vf, "-t", f"{d:.3f}", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", P("seg", i + ".mp4"))
    ff("-i", P("audio", i + ".mp3"), "-af", f"apad=whole_dur={d:.3f}", "-t", f"{d:.3f}", "-ar", "44100", "-ac", "2", P("seg", i + ".wav"))
    vl.append(f"file '{P('seg', i + '.mp4')}'"); al.append(f"file '{P('seg', i + '.wav')}'")
    starts[i] = t; t += d
TOTAL = t
open(P("seg", "v.txt"), "w").write("\n".join(vl)); open(P("seg", "a.txt"), "w").write("\n".join(al))


def ts(x):
    x = max(0, x); return f"{int(x // 3600)}:{int(x % 3600 // 60):02d}:{x % 60:05.2f}"


ass = ["[Script Info]", "ScriptType: v4.00+", "PlayResX: 1080", "PlayResY: 1920", "", "[V4+ Styles]",
       "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
       "Style: Word,Inter Display,104,&H00FFFFFF,&H00FFFFFF,&H00000000,&H78000000,-1,0,0,0,100,100,1,0,1,9,4,2,60,160,500,1",
       "Style: Talk,Inter Display,104,&H0000E1FF,&H00FFFFFF,&H00000000,&H78000000,-1,0,0,0,100,100,1,0,1,9,4,2,60,160,500,1",
       "Style: Hook,Inter Display,80,&H00FFFFFF,&H00FFFFFF,&H00000000,&H96000000,-1,0,0,0,100,100,0,0,3,22,0,8,50,50,360,1",
       "Style: Part,Inter Display,54,&H0000D7FF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,3,0,1,5,0,7,60,60,270,1",
       "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"]
first = LINES[0]["id"]
if EP.get("hook"):
    ass.append(f"Dialogue: 1,{ts(0)},{ts(SLOT[first])},Hook,,0,0,0,,{EP['hook']}")
ass.append(f"Dialogue: 1,{ts(0)},{ts(TOTAL)},Part,,0,0,0,,PART {EP['part']}")
if EP.get("next"):
    last = LINES[-1]["id"]
    ass.append(f"Dialogue: 1,{ts(starts[last])},{ts(TOTAL)},Hook,,0,0,0,,{EP['next']}")
for l in LINES:
    if l["id"] == first and EP.get("hook"):
        continue
    al_ = json.load(open(P("audio", l["id"] + ".json")))
    ws, cur, s, e = [], "", 0, 0
    for ch, a0, b0 in zip(al_["characters"], al_["character_start_times_seconds"], al_["character_end_times_seconds"]):
        if ch.isspace():
            if cur: ws.append((cur, s, e)); cur = ""
        else:
            if not cur: s = a0
            cur += ch; e = b0
    if cur: ws.append((cur, s, e))
    style = "Word" if l["who"] == "narrator" else "Talk"
    for k, (w, a0, b0) in enumerate(ws):
        end = ws[k + 1][1] if k + 1 < len(ws) and ws[k + 1][1] - b0 < 0.6 else b0 + 0.15
        word = w.strip('"').rstrip(",.;:").strip('"').upper()
        if word:
            t0 = starts[l["id"]]
            ass.append(f"Dialogue: 0,{ts(t0 + a0)},{ts(t0 + end)},{style},,0,0,0,,{{\\fscx88\\fscy88\\t(0,90,\\fscx100\\fscy100)}}{word}")
open(P("captions.ass"), "w").write("\n".join(ass) + "\n")
MP4 = P(NAME + ".mp4")
ff("-f", "concat", "-safe", "0", "-i", P("seg", "v.txt"), "-f", "concat", "-safe", "0", "-i", P("seg", "a.txt"),
   "-vf", f"subtitles={P('captions.ass')}", "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "medium", "-crf", "20",
   "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-t", f"{TOTAL:.2f}", "-movflags", "+faststart", MP4)
say(f"assembled · {TOTAL:.1f} s · {MP4}")
stop("assemble")

# ---------------------------------------------------------------- 7. critique
W, H = 135, 240
raw = subprocess.run(["ffmpeg", "-v", "error", "-i", MP4, "-vf", f"scale={W}:{H},format=gray", "-f", "rawvideo", "-"],
                     capture_output=True, check=True).stdout
F = np.frombuffer(raw, dtype=np.uint8).reshape(-1, H, W).astype(np.float32)
mot = np.concatenate([[9.9], np.abs(np.diff(F, axis=0)).mean(axis=(1, 2))])
DEAD = 0.08
shots = []
for l in LINES:
    a0, b0 = int(round(starts[l["id"]] * 30)), int(round((starts[l["id"]] + SLOT[l["id"]]) * 30))
    m = mot[a0 + 1:b0]
    run_, longest = 0, 0
    for v in m:
        run_ = run_ + 1 if v < DEAD else 0
        longest = max(longest, run_)
    score = 10.0 - max(0, longest - 8) / 4 - 6 * float((m < DEAD).mean() if len(m) else 0)
    notes = []
    if longest > 12:
        notes.append(f"frozen {longest / 30:.1f}s")
    if l["who"] != "narrator":
        face = np.abs(np.diff(F[a0:b0, 40:150, 30:105], axis=0)).mean() if b0 - a0 > 2 else 0
        if face < 0.12:
            score -= 3; notes.append("mouth barely moves")
    score = round(max(0.0, min(10.0, score)), 1)
    shots.append({"id": l["id"], "who": l["who"], "seconds": round(SLOT[l["id"]], 2), "longest_freeze_frames": longest,
                  "score": score, "passed": score >= 8, "notes": notes})
size = subprocess.check_output(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", MP4]).decode().strip()
vol = subprocess.run(["ffmpeg", "-i", MP4, "-af", "volumedetect", "-vn", "-f", "null", "-"], capture_output=True, text=True).stderr
peak = float(re.search(r"max_volume: (-?[\d.]+)", vol).group(1)); mean = float(re.search(r"mean_volume: (-?[\d.]+)", vol).group(1))
checks = {"over 1 minute": TOTAL >= 61, "1080x1920": size == "1080,1920", "not clipping": peak <= -0.3, "loud enough": mean >= -32}
ok = all(checks.values()) and all(s["passed"] for s in shots)
json.dump({"passed": ok, "seconds": round(TOTAL, 2), "checks": checks, "peak_db": peak, "mean_db": mean, "shots": shots},
          open(P("report.json"), "w"), indent=1)
items = []
for l, s in zip(LINES, shots):
    at = starts[l["id"]] + SLOT[l["id"]] * 0.6
    png = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{at:.3f}", "-i", MP4, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"],
                         capture_output=True).stdout
    img = Image.open(io.BytesIO(png)).convert("RGB")
    items.append((img, f"{s['id']} {s['score']}/10 {' '.join(s['notes'])}", (120, 220, 140) if s["passed"] else (240, 110, 100)))
sheet(items, P("review.jpg"))
for s in shots:
    say(f"{'PASS' if s['passed'] else 'FAIL'} {s['id']:<4} {s['who']:<9} {s['score']:>4}/10  {s['seconds']:>5}s  {' '.join(s['notes'])}")
for k, v in checks.items():
    say(f"{'ok  ' if v else 'FAIL'} {k}")
say(f"{'PASS' if ok else 'REDO'} · {TOTAL:.1f} s · look at {P('review.jpg')} · video {MP4}")
