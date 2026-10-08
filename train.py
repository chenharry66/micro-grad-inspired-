# run the training loop on a couple of audios made by me 
from voice_model import Voice_Model
from audio import decode_file
from pathlib import Path 
import json 
from engine import Value
from nn import Module

base = Path("recordings")

label = ["Meow", "Woof", "Moo"]

unique_paths = [("moo_recording1.wav",2), ("moo_recording3.wav", 2), ("meow_recording1.wav", 0), ("woof_recording1.wav",1),
("moo_recording2.wav", 2), ("meow_recording2.wav", 0), ("meow_recording3.wav", 0), 
("woof_recording2.wav",1), ("woof_recording3.wav", 1)]

dataset = [(decode_file(base / unique_path), correct) for unique_path, correct in unique_paths]

epochs = 1000
alpha = 0.01
model = Voice_Model() 
prev_loss = 0

def calculate_cross(logits):
    logits_exponentiated = [logit.exp() for logit in logits]
    sum_exp = sum(logits_exponentiated)
    probs = [exponentiated / sum_exp for exponentiated in logits_exponentiated]
    return probs

for epoch in range(epochs): 
    correct = 0
    total_loss = 0
    Module.zero_grad(model)

    for wave, true_label in dataset:
        loss = Value(0.0)
        logits = model(wave)
        probs = calculate_cross(logits)

        if epoch % 10 == 0:
            print(
            "target:", label[true_label],
            "probabilities:",
            [round(float(p.n), 4) for p in probs],
            )

        prediction = max(range(len(probs)), key= lambda i: probs[i].n)
        correct += (prediction == true_label)
        # true disitbution is one-hot 
        loss = -probs[true_label].ln()
        total_loss += loss.n
        loss.backward()
    
    loss_change = abs(prev_loss - total_loss)
    
    if loss_change < 1e-4: 
        break 

    print(f"Epoch {epoch }—Accuracy: {correct / len(dataset):.3f}, Loss: {total_loss:.6f}"
    )
    for parameter in model.parameters(): 
        parameter.n -= (alpha * parameter.grad)

    prev_loss = total_loss

saved_model = { 
    "model_name": "Animal_Net",
    "author": "Harry Chen", 
    "labels": ["Meow", "Woof", "Moo"],
    "weights": [param.n for param in model.parameters()]
}

with open('model.json', 'w') as json_file:
    json.dump(saved_model, json_file) 
    



