"""Read-only checkpoint views and probes around the real model forward pass."""
import hashlib
import json
import numpy as np

SAMPLE_RATE = 16000
STRIDE = 64  # The stride in Filter.__call__, checked against real outputs in tests.


def snapshot(model, labels):
    parameters = [float(p.n) for p in model.parameters()]
    digest = hashlib.sha256(json.dumps(parameters).encode()).hexdigest()[:12]
    filters = []
    offset = sum(len(layer.parameters()) for layer in model.nn.layers)
    for index, item in enumerate(model.filter_net.filters):
        coefficients = np.array([float(p.n) for p in item.coefficients])
        gain = np.abs(np.fft.rfft(coefficients, n=1024))
        frequencies = np.fft.rfftfreq(1024, d=1 / SAMPLE_RATE)
        filters.append({
            "index": index, "coefficients": coefficients.tolist(), "parameter_offset": offset,
            "frequency_hz": frequencies.tolist(), "gain": gain.tolist(),
            "peak_hz": float(frequencies[int(np.argmax(gain))]),
            "l2": float(np.linalg.norm(coefficients)), "dc_gain": float(abs(coefficients.sum())),
        })
        offset += len(coefficients)
    layers = []
    offset = 0
    for index, layer in enumerate(model.nn.layers):
        weights = [[float(p.n) for p in n.ws] for n in layer.neurons]
        biases = [float(n.b.n) for n in layer.neurons]
        layers.append({"index": index, "weights": weights, "biases": biases,
                       "activation": "tanh" if layer.neurons[0].nonlin else "linear",
                       "parameter_offset": offset})
        offset += len(layer.parameters())
    return {"checkpoint": digest, "parameter_count": len(parameters), "sample_rate": SAMPLE_RATE,
            "stride": STRIDE, "labels": labels, "filters": filters, "layers": layers}


class Probe:
    def __init__(self, target, record):
        self.target, self.record = target, record

    def __getattr__(self, name):
        return getattr(self.target, name)

    def __call__(self, values):
        result = self.target(values)
        self.record(values, result)
        return result


def numbers(values):
    return [float(x.n if hasattr(x, "n") else x) for x in values]


def trace_forward(model, samples, labels):
    """Observe exact intermediate values without reimplementing inference."""
    trace = {"model": snapshot(model, labels), "samples": samples, "layers": []}
    original_filters, original_pool = model.filter_net, model.get_response_features
    original_layers = model.nn.layers

    def record_filters(_inputs, outputs):
        trace["responses"] = [numbers(row) for row in outputs]

    def record_pool(inputs, segments=4):
        result = original_pool(inputs, segments)
        trace["pooled"] = numbers(result)
        count = len(inputs[0])
        size = count // segments
        trace["pooling"] = {"segments": segments, "responses_per_segment": size,
                            "used_responses": size * segments, "discarded_responses": count - size * segments}
        return result

    def record_layer(index, inputs, outputs):
        values = numbers(inputs)
        if index == 0:
            trace["features"] = values
        layer = trace["model"]["layers"][index]
        pre = [sum(w * x for w, x in zip(row, values)) + b
               for row, b in zip(layer["weights"], layer["biases"])]
        trace["layers"].append({"inputs": values, "preactivation": pre, "outputs": numbers(outputs)})

    model.filter_net = Probe(original_filters, record_filters)
    model.get_response_features = record_pool
    model.nn.layers = [Probe(layer, lambda x, y, i=i: record_layer(i, x, y))
                       for i, layer in enumerate(original_layers)]
    try:
        logits = numbers(model(samples))
    finally:
        model.filter_net = original_filters
        model.get_response_features = original_pool
        model.nn.layers = original_layers
    length = len(trace["model"]["filters"][0]["coefficients"])
    trace["response_sample_indices"] = list(range(length - 1, len(samples), STRIDE))
    if len(trace["response_sample_indices"]) != len(trace["responses"][0]):
        raise ValueError("Filter stride changed; update inspection metadata.")
    return logits, trace
