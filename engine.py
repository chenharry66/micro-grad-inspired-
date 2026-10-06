class Value: 
    def __init__(self, n): 
        self.n = n 
    
    def __add__(self, n): 
        return n + n 