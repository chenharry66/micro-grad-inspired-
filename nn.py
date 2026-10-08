import random
from engine import Value 

class Module: 
    def zero_grad(self): 
        for param in self.parameters(): 
            param.grad = 0

class Neuron: 
    # no need to store its actually inpts
    def __init__(self, nin, nonlin=True): 
        # weight for every input 
        self.b = Value(random.random())
        self.ws = [Value(random.uniform(-1, 1)) for _ in range(nin)]
        self.nonlin = nonlin
    # some input of length x 
    def __call__(self,x): 
        # zip the weights 
        products = [wi * xi for wi, xi in zip(self.ws, x)]
        summ = sum(products, self.b)
        # sum is just another Value so it has the tanh 
        return summ.tanh() if self.nonlin else summ 
    def __repr__(self): 
        return f"Neuron of length {len(self.ws)}"
    def parameters(self): 
        # copy refernece to same value objects 
        return ([weight for weight in self.ws] + [self.b]) 

class Layer:
    # where nin is the number of neurons feeding into this layer, for FC layer this is just the length 
    # of each neuron 
    def __init__(self, nin, nout, nonlin=True): 
        self.neurons = [Neuron(nin, nonlin) for _ in range(nout)]
    # x is the input that is feed into each of the neurosn
    def __call__(self, x): 
        return [n(x) for n in self.neurons]
    def parameters(self): 
        return [param for neuron in self.neurons for param in neuron.parameters()]
    def __repr__(self): 
        return f"Layer with {nout} neurons"

class MLP: 
    # nouts is number of outputs at each layer/number of neurons
    def __init__(self, nin, nouts): 
        sizes = [nin] + nouts
        self.layers = [Layer(sizes[i], sizes[i+1], nonlin=(i != len(nouts) -1)) for i in range(len(sizes) - 1)]
    def parameters(self): 
        #order oesnt matter we have the referenes to the values that we can modiy 
        # stored in the neurons themselves and then we can just tweak them
        return [param for layer in self.layers for param in layer.parameters()] 
    def __call__(self, x):
        for layer in self.layers: 
            x = layer(x)
        return x 
    def __repr__(self): 
        return f"MLP with {len(nouts)} layers"
# so the quesiton is how do i know what to tune 
# so it sjust the weights and biases of all the neurons 
# 
    

