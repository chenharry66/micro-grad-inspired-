from engine import Value
import random 
import math

class Filter:
# you want the squared value filter response to be equal to the square of sample 
# square because you don't care about the actual lenght, use that to initialize coefficients
    def __init__(self, length): 
        self.length = length 
        bound = 3 / math.sqrt(length)
        self.coefficients = [Value(random.uniform(-bound, bound)) for _ in range(self.length)]
    
    def parameters(self): 
        return self.coefficients
    # iteraitng on the audio from k, to end apply the filter 
    def __call__(self, x): 
        out = []
        for i in range(self.length-1, len(x), 64): 
            total = Value(0.0) 
            for j, coefficient in zip(range(i, i-self.length, -1), self.coefficients):
                total += (x[j] * coefficient)
            out.append(total)
        return out

    def __repr__(self): 
        return f"Filter of Length {self.length}"

class Filter_Net: 
    def __init__(self, num_filters, filter_length): 
        self.num_filters = num_filters
        self.filter_length = filter_length
        self.filters = [Filter(filter_length) for _ in range(num_filters)]
    # where x is the input wave we just compile all of them together 
    def __call__(self,x): 
        res = []
        for a_filter in self.filters: 
            mini = a_filter(x)
            res.append(mini)     
        return res 
        # return [a_filter(x) for a_filter in self.filters]
    def parameters(self): 
        return [p for f in self.filters for p in f.parameters() ]
    def __repr__(self): 
        return f"Filter Network with {num_filters} of Length {filter_length}"