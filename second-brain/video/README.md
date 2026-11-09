# Making a SQUEEZED episode

Rules: no cussing, never the Lord's name in vain, 1080x1920, captions low (never over faces), characters lip-synced.

Services (keys are saved on the cloud environment, never in this repo):
- fal.ai (`queue.fal.run`; downloads from `v3.fal.media` / `v3b.fal.media`)
  - pictures: `fal-ai/nano-banana/edit` with the character pictures in `characters/` as references
  - moving scenes: `fal-ai/kling-video/v2.1/standard/image-to-video` (5 or 10 s)
  - talking close-ups: `fal-ai/kling-video/ai-avatar/v2/standard` (picture + line audio -> lip sync)
- ElevenLabs voices (`api.elevenlabs.io`, eleven_multilingual_v2, with-timestamps):
  - Narrator: nPczCjzI2devNBz1zQrb
  - Peaches: EXAVITQu4vr4xnSDxMaL
  - Grandpa Pine: pqHfZKP75CvOlQylNhV4
  - Mr. Lemons: N2lVS1w4EtoT3dr4eOWO

Steps: write `lines.json` (id, speaker, scene, text; ids starting with `d` are character lines),
record each line, make one 9:16 picture per scene, animate narrator scenes with Kling and
character lines with the avatar model, then run `assemble2.py`.
Part 1 cost about $8 on fal.
