"""Time speech-to-text models on 10-second audio pieces. Prints timings only."""
import glob, os, sys, time
import torch
from transformers import pipeline

model, piece_dir = sys.argv[1], sys.argv[2]
torch.set_num_threads(os.cpu_count())
gen = dict(no_repeat_ngram_size=3, repetition_penalty=1.3, num_beams=3)
t = time.time()
asr = pipeline("automatic-speech-recognition", model=model, device="cpu")
print(f"[{model}] loaded in {time.time() - t:.0f}s on {os.cpu_count()} cpus", flush=True)
files = sorted(glob.glob(f"{piece_dir}/p*.wav"))
total = 0.0
for f in files:
    t = time.time()
    text = asr(f, generate_kwargs=gen)["text"] if asr.model.config.model_type == "whisper" else asr(f)["text"]
    total += time.time() - t
print(f"[{model}] {len(files)} pieces, {10 * len(files)}s audio in {total:.0f}s "
      f"({total / max(1, 10 * len(files)):.2f}s per audio second)", flush=True)
