import wave, subprocess, json, sys
from narration import N
from piper import PiperVoice
v = PiperVoice.load('voice/en_US-lessac-medium.onnx')
dur = {}
import os
os.makedirs('audio', exist_ok=True)
for k, t in N.items():
    with wave.open(f'audio/{k}.wav', 'wb') as w:
        v.synthesize_wav(t, w)
    with wave.open(f'audio/{k}.wav') as w: dur[k] = w.getnframes()/w.getframerate()
    print(k, round(dur[k],1), len(t.split()))
json.dump(dur, open('audio/dur.json','w'))
print('total', sum(dur.values()))
