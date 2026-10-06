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
    # iteraitng on the audio from k, to end apply the filter 
    def __call__(self, x): 
        out = []
        for i in range(self.length-1, len(x)): 
            total = Value(0.0) 
            for j, coefficient in zip(range(i, i-k), self.coefficients):
                total += (Value(x[j]) * coefficient)
            out.append(sub_sum)
        return out

    def __repr__(self): 
        return f"Filter of Length {self.length}"

class Filter_Net: 
    def __init__(self, num_filters, filter_length): 
        self.num_filters = num_filters
        self.filter_length = filter_length
        self.filters = [Filter(filter_length) for _ in num_filters]
    # where x is the input wave we just compile all of them together 
    def __call__(x): 
        return [filter(x) for filter in self.filters]
      def __repr__(self): 
        return f"Filter Network with {num_filters} of Length {filter_length}"
        
print(Filter(5))