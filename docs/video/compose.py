import json, wave, re, subprocess, sys
import numpy as np
from narration import N
offs = json.load(open('offs.json')); DUR = json.load(open('audio/dur.json'))
SHIFT = float(sys.argv[1]) if len(sys.argv) > 1 else 0.0   # video-vs-clock calibration
total = offs['_end'] + 0.5
SR = 22050
buf = np.zeros(int(total * SR) + SR, dtype=np.float32)
for k in N:
    with wave.open(f'audio/{k}.wav') as w:
        assert w.getframerate() == SR, w.getframerate()
        a = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    i = int((offs[k] + SHIFT) * SR); buf[i:i+len(a)] += a
buf = np.clip(buf * 0.95, -1, 1)
with wave.open('narration.wav', 'wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((buf * 32767).astype(np.int16).tobytes())

def ts(t):
    h = int(t // 3600); m = int(t % 3600 // 60); s = t % 60
    return f'{h}:{m:02d}:{s:05.2f}'
lines = []
for k, text in N.items():
    sents = re.split(r'(?<=[.:;?!])\s+', text.strip())
    chunks = []
    for s in sents:   # split long sentences at commas to keep captions <= ~95 chars
        parts = [s]
        while any(len(p) > 95 for p in parts):
            out = []
            for p in parts:
                if len(p) <= 95: out.append(p); continue
                idx = [m.start() for m in re.finditer(r', | and | but ', p)]
                cut = min(idx, key=lambda i: abs(i - len(p)/2)) if idx else p.rfind(' ', 0, len(p)//2)
                cut = cut + 1 if p[cut] == ',' else cut
                out += [p[:cut].strip(), p[cut:].strip()]
            parts = out
        chunks += parts
    tot = sum(len(c) for c in chunks); t = offs[k] + SHIFT
    for c in chunks:
        d = DUR[k] * len(c) / tot
        lines.append((t, t + d, c)); t += d
hdr = """[Script Info]
ScriptType: v4.00+
PlayResX: 1600
PlayResY: 900
WrapStyle: 0

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Cap,Inter,32,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,2,40,40,28,1

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
"""
with open('captions.ass', 'w') as f:
    f.write(hdr)
    for a, b, c in lines: f.write(f'Dialogue: 0,{ts(a)},{ts(b)},Cap,,0,0,0,,{c}\n')
print(len(lines), 'caption lines')
def srt_ts(t):
    ms = int(round(t*1000)); return f'{ms//3600000:02d}:{ms//60000%60:02d}:{ms//1000%60:02d},{ms%1000:03d}'
with open('demo.srt', 'w') as f:
    for i, (a, b, c) in enumerate(lines, 1): f.write(f'{i}\n{srt_ts(a)} --> {srt_ts(b)}\n{c}\n\n')
