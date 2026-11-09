# Faceless account studio

Everything for the monetized faceless TikTok account (Pixar-style AI fruit karma dramas).
Nothing here is about Extreme Home Lighting or Christmas lights.

## Make an episode (one command)

```bash
python3 faceless/studio/make_episode.py faceless/series/squeezed/part-02.json --stop-after stills
#   look at faceless/out/squeezed-part-02/review_stills.jpg ; redo any bad picture:
python3 faceless/studio/make_episode.py faceless/series/squeezed/part-02.json --redo n05,n06 --stop-after stills
#   then make the whole video and grade it:
python3 faceless/studio/make_episode.py faceless/series/squeezed/part-02.json
#   look at review.jpg ; --redo any bad shot ; repeat until it prints PASS
```

The video lands in `faceless/out/<series>-part-NN/<series>-part-NN.mp4` (not committed).

What the studio does, in order (each step is cached, so re-runs only redo what's missing):

1. **rules**: blocks cussing and the Lord's name in vain; warns if too short for 1 minute
2. **cast**: makes a reference picture for any character without one (commit it!)
3. **voices**: narrator and each character in their own ElevenLabs voice, with word timings
4. **stills**: one 9:16 picture per line from the character reference pictures (nano-banana)
5. **clips**: narrator lines come alive (Kling 2.1); character lines become lip-synced close-ups (Kling avatar)
6. **assemble**: each shot cut to its line, one-word captions low on screen (white narrator,
   yellow character), hook at the top, PART tag, "PART N TOMORROW" on the last line, 1080x1920
7. **critique**: watches every frame for frozen shots and still mouths, checks length > 1 minute,
   size, loudness, and grades every shot out of 10. Then a person (or Claude) looks at
   `review.jpg` for wrong faces, extra look-alike characters or gibberish text, and redoes those shots.

Cost: about $6-9 of fal credit per 75-90 s episode, plus ElevenLabs characters.

## Episode file (`part-NN.json`)

```json
{
  "part": 3,
  "title": "...(Part 3)",
  "hook": "First line on screen\\NSecond line",
  "next": "PART 4 TOMORROW",
  "caption": "TikTok caption with hashtags",
  "lines": [
    {"id": "n01", "who": "narrator", "text": "What the narrator says.",
     "shot": {"cast": ["peaches"], "scene": "Full picture description: place, light, who is where, what they do.",
              "motion": "How the picture moves."}},
    {"id": "d01", "who": "lemons", "text": "What Mr. Lemons says (lip-synced close-up).",
     "shot": {"scene": "Where he is and his expression.", "motion": "angry, jabbing his finger"}}
  ]
}
```

- `who`: `narrator` or a character key from `cast.json` (`peaches`, `pine`, `lemons`, `razz`).
- Narrator shots list the characters in the picture in `cast`; say "No other people anywhere in
  the picture" when a shot should be empty, or the model adds look-alike extras.
- Never ask for readable text in a picture (signs, letters, phone screens): it comes out as gibberish.
- 200-230 words total = 75-90 seconds.

## Rules (Corbin's)

- No cussing, never the Lord's name in vain (the rules step enforces it).
- TikTok size 1080x1920, no black bars; text out of the top 250 px, bottom 450 px, right 140 px;
  captions never over a face.
- Original characters and stories only; nobody gets hurt on screen; turn on TikTok's AI-generated label.

## Files

- `studio/make_episode.py`, `studio/fal.py`: the episode studio
- `series/squeezed/cast.json`: style, voices and exact character descriptions
- `series/squeezed/characters/`: reference pictures (keep them; they keep faces consistent)
- `series/squeezed/part-NN.json`: one file per episode
- `motion/`: code-rendered motion graphics (title cards, end cards) with its own self-critique
