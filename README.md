# micro-grad-inspired-
Goofy mini project inspired by Karapathy's micrograd

## Run Miso

With the existing Python environment (`numpy` and `av` installed):

```sh
python3 server.py
```

Open **http://127.0.0.1:8001**. Click the microphone or press **Space**, allow microphone access, and make a sound as soon as “Listening” appears. The app captures exactly one second, stops the microphone, predicts Meow / Woof / Moo, and plays the matching character animation. The original character workshop remains in `character/`.

The browser records mono PCM using an AudioWorklet at the device's sample rate. Python uses the existing `audio.decode_bytes` conversion to 16,000 samples and the actual `Voice_Model` forward pass. `model.json` reloads for every prediction, including newly saved training weights. A partial or incompatible checkpoint produces a retryable error. The checkpoint must have been trained with the current model code; the existing file does not record architecture or preprocessing versions.

Audio is processed locally and not written to files by the server. The latest microphone recording and its analysis are retained in browser session storage for the Model Lab; clear them in the lab or close the tab. The server binds only to loopback. For remote hosting, microphone access requires HTTPS and the local development server should be replaced with a production deployment. Prediction percentages are model scores, not calibrated guarantees; the current small training dataset limits accuracy.

```sh
python3 -m unittest discover -s tests -p 'test_*.py'
node tests/recorder.test.cjs
```

Web Audio references: [AudioWorklet processing](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletProcessor/process), [microphone permission and secure contexts](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).

## Model Lab

Open **http://127.0.0.1:8001/model**, or select **Model lab** in the navigation. Restart `server.py` after pulling server changes.

- Explore the full connected model: waveform → four filters → 16 features → two hidden layers → three logits. Select a node to highlight its connections and inspect actual contributions. “Follow the signal” replays recorded stages without training or changing weights.
- Inspect all four filters, their 101 coefficients, linear magnitude frequency responses, and exact checkpoint parameter indices.
- Analyze a local WAV from `recordings/`, or follow **Inspect this prediction** after a microphone recording.
- Move a window through all 249 filter steps to see the input samples, weighted products, actual response, and segment assignment.
- Compare all four filters in the response heatmap, select a moment with the mouse or arrow keys, and jump to each filter's strongest absolute response. Play or pause a slow-motion scan through the calculation.
- Inspect all 16 pooled/scaled features, layer activations and tanh saturation, logits, and softmax scores.
- Select any dense weight or bias to see its full value, checkpoint index, and contribution for the loaded recording.

`inspection.py` observes the real `Voice_Model` forward pass with temporary instance-level probes. It restores those probes afterward, never edits weights, and requires no changes to the running training script. Frequency responses use `abs(numpy.fft.rfft(coefficients, n=1024))` with a 16 kHz frequency axis. They describe the FIR response before stride sampling; they do not establish semantic labels or learned importance. The UI identifies the one trailing response discarded by the current four-segment pooling code.

Checkpoint IDs hash the weights used for the trace. Loading an older microphone trace displays its own parameter snapshot, avoiding mixing it with newer saved weights. Refresh returns to the latest saved model. Training currently saves only at completion, so this is not a live epoch dashboard and has no weight-change history. For a new architecture, update inspection stride/architecture metadata and run the parity tests. Existing example recordings are training inputs, not a held-out evaluation set.
