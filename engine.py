# a value can be the child of multiple parents but a parent can only two children
# each number just needs to figure out how it distibutes it gradient to its two chidlren 
import numpy as np 

class Value: 
    def __init__(self, n, _children =(), _op=''): 
        self.n = n 
        self.grad = 0 
        self._backward = lambda: None 
        self._prev = set(_children) 
        self._op = _op

    def __add__(self, other): 
        other = other if isinstance(other, Value) else Value(other)
        out = Value(self.n + other.n, (self, other), '+')

        def backward(): 
            self.grad += (out.grad) 
            other.grad += (out.grad)
        out._backward = backward
        return out
        # the addition and multiplication handle backwar 
    
    def __mul__(self, other): 
        other = other if isinstance(other, Value) else Value(other)
        out = Value(self.n * other.n, (self, other), '*')

        def backward(): 
            self.grad += (out.grad * other.n)
            other.grad += (out.grad * self.n)
        out._backward = backward
        return out

    def __neg__(self): 
        return -1 * self
    # + evalautes to the __add__ method 
    def __radd__(self, other): 
        return self + other 

    def __rmul__(self, other):
        return self * other 

    def __sub__(self, other): 
        other = other if isinstance(other, Value) else Value(other) 
        out = self + -other
        return out 

    def __pow__(self, other):  
        # assume cosntant unchanged doesn't prpogate any graient doesn't receive
        assert isinstance(other, (int, float))
        
        out = Value(self.n ** other, (self,), f"**{other}")
        def backward(): 
            self.grad += (other * self.n ** (other-1)) * out.grad
        out._backward = backward
        return out 

    def tanh(self): 
        out = Value(np.tanh(self.n), (self,), 'tanh')
        def backward(): 
            # local derivative times the grad flowing 
            self.grad += ((1-out.n**2)) * out.grad
        out._backward = backward
        return out 

    def __repr__(self): 
        return f"Value {self.n}"

    # only call this on the root node/noe youre backporpgating from 
    def backward(self): 
        visited = set() 
        finished = []

        def dfs(node):
            if node not in visited: 
                visited.add(node) 
                for child in node._prev: 
                    dfs(child)
                finished.append(node)
        # done processing all children then mark as finished 
        dfs(self)

        self.grad = 1

        finished.reverse() 
        
        for node in finished: 
            node._backward() 
