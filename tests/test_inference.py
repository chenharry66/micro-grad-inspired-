import contextlib
import io
import json
import math
from pathlib import Path
import tempfile
import unittest
import wave

import server


def recording(rate=48000, duration=1):
    import struct
    output = io.BytesIO()
    with wave.open(output, 'wb') as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(rate)
        samples = [int(1500 * math.sin(i * 2 * math.pi * 330 / rate)) for i in range(int(rate * duration))]
        audio.writeframes(struct.pack(f'<{len(samples)}h', *samples))
    return output.getvalue()


class InferenceTests(unittest.TestCase):
    def test_one_second_at_browser_sample_rates(self):
        for rate in (16000, 44100, 48000):
            payload = recording(rate)
            server.validate_audio(payload)
            self.assertEqual(len(server.decode_bytes(payload)), 16000)

    def test_rejects_truncated_invalid_and_wrong_duration_audio(self):
        for payload in (b'not wav', recording()[:-200], recording(duration=.5), recording(duration=2)):
            with self.assertRaises(ValueError):
                server.validate_audio(payload)

    def test_checkpoint_validation_and_reload(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'model.json'
            weights = [0.] * len(server.Voice_Model().parameters())
            saved = {'labels': server.LABELS, 'weights': weights}
            path.write_text(json.dumps(saved))
            self.assertEqual(server.load_model(path).parameters()[0].n, 0)
            weights[0] = .75
            path.write_text(json.dumps(saved))
            self.assertEqual(server.load_model(path).parameters()[0].n, .75)
            for invalid in ('{', json.dumps({'labels': server.LABELS, 'weights': [0]}),
                            json.dumps({'labels': server.LABELS, 'weights': [float('nan')] * len(weights)})):
                path.write_text(invalid)
                with self.assertRaises(server.ModelUnavailable):
                    server.load_model(path)

    def test_forward_pass_label_order_and_training_softmax(self):
        # Known output biases through the real model catch parameter order errors.
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'model.json'
            model = server.Voice_Model()
            for parameter in model.parameters():
                parameter.n = 0.
            for neuron, bias in zip(model.nn.layers[-1].neurons, [1., 2., 3.]):
                neuron.b.n = bias
            path.write_text(json.dumps({'labels': server.LABELS, 'weights': [p.n for p in model.parameters()]}))
            with contextlib.redirect_stdout(io.StringIO()):
                result = server.predict(recording(), path)
            self.assertEqual(result['label'], 'Moo')
            self.assertAlmostEqual(sum(result['probabilities'].values()), 1.)
            self.assertAlmostEqual(result['probabilities']['Moo'], 1 / (1 + math.exp(-1) + math.exp(-2)))
            # Use the training engine's actual exp / sum operations for parity.
            from engine import Value
            exponentiated = [Value(bias).exp() for bias in [1., 2., 3.]]
            expected = [value / sum(exponentiated) for value in exponentiated]
            for label, probability in zip(server.LABELS, expected):
                self.assertAlmostEqual(result['probabilities'][label], probability.n, places=15)
            for bias in (1000., -1000.):
                for neuron in model.nn.layers[-1].neurons:
                    neuron.b.n = bias
                path.write_text(json.dumps({'labels': server.LABELS, 'weights': [p.n for p in model.parameters()]}))
                with contextlib.redirect_stdout(io.StringIO()), self.assertRaisesRegex(server.ModelUnavailable, 'overflowed or underflowed'):
                    server.predict(recording(), path)


if __name__ == '__main__':
    unittest.main()
