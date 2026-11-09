"""SQUEEZED Part 1 v2: narrator + lip-synced character lines, captions low (below faces), TikTok 1080x1920."""
import json, subprocess, os

L = json.load(open("v2/lines.json"))
HOOK = "She got fired for paying\\Nfor an old man's juice"
PART = "PART 1"
GAP_N, GAP_D = 0.22, 0.35  # pause after a narrator line / after a character line
OUT = "SQUEEZED_Part1.mp4"


def probe(f):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]))


def ff(*args):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)


os.makedirs("v2/seg", exist_ok=True)
VF = "fps=30,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1"
slots, vlist, alist, t = [], [], [], 0.0
for lid, spk, scene, text in L:
    al = json.load(open(f"v2/audio/{lid}.json"))
    adur = al["character_end_times_seconds"][-1]
    d = adur + (GAP_D if lid.startswith("d") else GAP_N)
    if lid.startswith("d"):
        src = f"v2/talk/{lid}.mp4"
        vf = f"{VF},tpad=stop_mode=clone:stop_duration=3"
    else:
        src = f"clips/{scene}.mp4"
        c = probe(src) - 0.05
        slow = min(max(d / c, 1.0), 1.6)
        vf = f"setpts={slow:.4f}*PTS,{VF},tpad=stop_mode=clone:stop_duration=6"
    ff("-i", src, "-an", "-vf", vf, "-t", f"{d:.3f}", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
       "-pix_fmt", "yuv420p", f"v2/seg/{lid}.mp4")
    ff("-i", f"v2/audio/{lid}.mp3", "-af", f"apad=whole_dur={d:.3f}", "-t", f"{d:.3f}", "-ar", "44100", "-ac", "2",
       f"v2/seg/{lid}.wav")
    vlist.append(f"file '{os.path.abspath(f'v2/seg/{lid}.mp4')}'")
    alist.append(f"file '{os.path.abspath(f'v2/seg/{lid}.wav')}'")
    slots.append((lid, t, al))
    t += d
total = t
open("v2/seg/v.txt", "w").write("\n".join(vlist))
open("v2/seg/a.txt", "w").write("\n".join(alist))


def ts(x):
    x = max(0, x); return f"{int(x // 3600)}:{int(x % 3600 // 60):02d}:{x % 60:05.2f}"


# Captions: one word at a time, bottom-center just above TikTok's caption area (clear of faces)
ass = ["[Script Info]", "ScriptType: v4.00+", "PlayResX: 1080", "PlayResY: 1920", "", "[V4+ Styles]",
       "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
       "Style: Word,Inter Display,104,&H00FFFFFF,&H00FFFFFF,&H00000000,&H78000000,-1,0,0,0,100,100,1,0,1,9,4,2,60,160,500,1",
       "Style: Talk,Inter Display,104,&H0000E1FF,&H00FFFFFF,&H00000000,&H78000000,-1,0,0,0,100,100,1,0,1,9,4,2,60,160,500,1",
       "Style: Hook,Inter Display,84,&H00FFFFFF,&H00FFFFFF,&H00000000,&H96000000,-1,0,0,0,100,100,0,0,3,22,0,8,50,50,360,1",
       "Style: Part,Inter Display,54,&H0000D7FF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,3,0,1,5,0,7,60,60,270,1",
       "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"]
first_end = slots[1][1]
ass.append(f"Dialogue: 1,{ts(0)},{ts(first_end)},Hook,,0,0,0,,{HOOK}")
ass.append(f"Dialogue: 1,{ts(0)},{ts(total)},Part,,0,0,0,,{PART}")
for lid, t0, al in slots:
    if lid == "n00":
        continue  # the hook text already shows this line
    words, cur, s = [], "", 0
    for ch, a, b in zip(al["characters"], al["character_start_times_seconds"], al["character_end_times_seconds"]):
        if ch.isspace():
            if cur: words.append((cur, s, e)); cur = ""
        else:
            if not cur: s = a
            cur += ch; e = b
    if cur: words.append((cur, s, e))
    style = "Talk" if lid.startswith("d") else "Word"  # character lines in yellow
    for i, (w, a, b) in enumerate(words):
        end = words[i + 1][1] if i + 1 < len(words) and words[i + 1][1] - b < 0.6 else b + 0.15
        word = w.strip('"').rstrip(",.;:").strip('"').upper()
        if word:
            ass.append(f"Dialogue: 0,{ts(t0 + a)},{ts(t0 + end)},{style},,0,0,0,,{{\\fscx88\\fscy88\\t(0,90,\\fscx100\\fscy100)}}{word}")
open("v2/captions.ass", "w").write("\n".join(ass) + "\n")

ff("-f", "concat", "-safe", "0", "-i", "v2/seg/v.txt", "-f", "concat", "-safe", "0", "-i", "v2/seg/a.txt",
   "-vf", "subtitles=v2/captions.ass", "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "medium",
   "-crf", "21", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-t", f"{total:.2f}", "-movflags", "+faststart", OUT)
print("done", round(total, 2))
