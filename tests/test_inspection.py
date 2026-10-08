import contextlib
import gc
import io
import math
import unittest

import numpy as np
import server
from inspection import snapshot, trace_forward


class InspectionTests(unittest.TestCase):
    def tearDown(self):
        gc.collect()

    def test_parameter_mapping_and_frequency_response(self):
        model = server.load_model()
        data = snapshot(model, server.LABELS)
        params = [p.n for p in model.parameters()]
        self.assertEqual(data['parameter_count'], len(params))
        for layer in data['layers']:
            flattened = [value for row, bias in zip(layer['weights'], layer['biases']) for value in [*row, bias]]
            start = layer['parameter_offset']
            np.testing.assert_allclose(params[start:start + len(flattened)], flattened, rtol=0, atol=0)
        for item in data['filters']:
            start = item['parameter_offset']
            self.assertEqual(params[start:start + 101], item['coefficients'])
        for coefficient in model.filter_net.filters[0].coefficients:
            coefficient.n = 0.
        model.filter_net.filters[0].coefficients[0].n = 1.
        impulse = snapshot(model, server.LABELS)['filters'][0]
        np.testing.assert_allclose(impulse['gain'], 1.)
        self.assertEqual(impulse['frequency_hz'][0], 0)
        self.assertEqual(impulse['frequency_hz'][-1], 8000)

    def test_trace_matches_forward_pass_and_every_sliding_dot_product(self):
        model = server.load_model()
        samples = [.04 * math.sin(i * .12) + .015 * math.cos(i * .021) for i in range(16000)]
        original_filter_net, original_layers = model.filter_net, model.nn.layers
        with contextlib.redirect_stdout(io.StringIO()):
            expected = [float(value.n) for value in model(samples)]
            actual, trace = trace_forward(model, samples, server.LABELS)
        np.testing.assert_allclose(actual, expected, rtol=0, atol=0)
        self.assertIs(model.filter_net, original_filter_net)
        self.assertIs(model.nn.layers, original_layers)
        self.assertEqual(len(trace['responses'][0]), 249)
        self.assertEqual(trace['pooling']['used_responses'], 248)
        self.assertEqual(trace['pooling']['discarded_responses'], 1)
        for f, item in enumerate(trace['model']['filters']):
            computed = [sum(w * samples[t - j] for j, w in enumerate(item['coefficients']))
                        for t in trace['response_sample_indices']]
            np.testing.assert_allclose(trace['responses'][f], computed, rtol=1e-12, atol=1e-12)
            for segment in range(4):
                values = computed[segment * 62:(segment + 1) * 62]
                energy = sum(x*x for x in values) / 62
                self.assertAlmostEqual(trace['pooled'][segment * 4 + f], energy)
                self.assertAlmostEqual(trace['features'][segment * 4 + f], energy * 1000)
        for layer, recorded in zip(trace['model']['layers'], trace['layers']):
            if layer['activation'] == 'tanh':
                np.testing.assert_allclose(np.tanh(recorded['preactivation']), recorded['outputs'], atol=1e-12)
            else:
                np.testing.assert_allclose(recorded['preactivation'], actual, atol=1e-12)


if __name__ == '__main__':
    unittest.main()
