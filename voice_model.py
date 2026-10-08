from filter_net import Filter_Net 
from nn import MLP 
# input: 1 second of audio sampled at 16k hz which is just 16,000 samples 
# 16,000 samples -> 4 filters, length 101  -> each filter output is then of length 16000-101+1
# filter_net 
class Voice_Model:
    def __init__(self):
        self.filter_net = Filter_Net(4, 101) 
        self.nn = MLP(16, [16, 16, 3])
    def get_response_features(self, responses, segments=4): 
        # combine the responses of length 15900 into somehting
        features = []
        for segment in range(segments): 
            for response in responses: 
                start = segment * (len(response) // segments)
                stop = (segment + 1) * (len(response) // segments)
                chunk = response[start:stop]
                mean_squared_power = sum(c ** 2 for c in chunk) / len(chunk)
                features.append(mean_squared_power)
        return features
    def __call__(self, x):
        responses = self.filter_net(x)
        response_features = self.get_response_features(responses) 
        response_features = [feature * 1000 for feature in response_features]
        print("features:", [f"{f.n:.3e}" for f in response_features])
        return self.nn(response_features)
    def parameters(self): 
        return self.nn.parameters() + self.filter_net.parameters()
    def __repr__(self):
        return f"Voice_Model(filter_length=101, nn={self.nn!r})"

    