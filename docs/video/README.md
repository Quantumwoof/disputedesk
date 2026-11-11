# How `docs/demo.mp4` was produced (reproducible, headless)

Nothing here is a mock-up: the video is a real browser session against the real dashboard, driven by Playwright and recorded headlessly, with synthetic narration. The banner `DEMO · local PayPal simulator` is visible in every app shot.

* `narration.py`: the exact narration text, one entry per scene.
* `tts.py`: free offline text-to-speech with [Piper](https://github.com/rhasspy/piper) (voice `en_US-lessac-medium`).
* `slides.py`: title, results and end-card slides (all figures copied from `eval/results/` and the README).
* `record.py`: drives Chrome (1600×810 viewport, video capture, on-screen cursor) through the scenes in sync with the narration timings. Scene 2 uses the offline engine (`:4100`, `/?manual` so the queue starts empty and *Run agent triage* is clicked on camera); scenes 4–8 use an instance with the free LLM (`:4101`) that was triaged beforehand, because the anonymous free tier needs roughly 3 minutes to triage 12 disputes.
* `compose.py`: builds the narration track and captions, then `ffmpeg` pads a caption strip, burns the captions in, scales to 1920×1080 and encodes H.264/AAC (equivalent to `ffmpeg -i raw.webm -i narration.wav -vf "pad=1600:900:0:0:color=0x0b1224,ass=captions.ass,scale=1920:1080,format=yuv420p" -c:v libx264 -crf 20 -c:a aac demo.mp4`).
* `retake.sh`: restarts both demo apps in a pristine state for another take.

Scripts expect to run from one scratch folder containing a `voice/` directory with the Piper model, the two demo apps running (`retake.sh`), and write `audio/`, `raw/`, `demo.mp4` there. Setup used: `python -m venv venv && venv/bin/pip install piper-tts playwright numpy`, `playwright install ffmpeg`, system Chrome and `ffmpeg` with libass. Not required to run DisputeDesk itself.
