# Miso

A goofy little learning project inspired by Andrej Karpathy’s micrograd.

I wanted to reinforce my understanding by reimplementing micrograd from scratch, then adding a basic animal-sound classifier: **meow, moo, and woof**. I hand-coded the autograd engine, neural network, and audio classification model from scratch. After building and training the model, I had Codex build the frontend and visualizations so I could see how my model actually worked.

This was a quick project to learn from and have fun with, not a polished classifier or portfolio project.

## Run it

You’ll need Python 3, NumPy, and PyAV. From the project folder:

```sh
python3 -m pip install numpy av
python3 server.py
```

Open **http://127.0.0.1:8001**. The saved model is included, so you don’t need to train it first.

Press **Space** or click **Make a sound**, allow microphone access, and make an animal noise when “Listening” appears. Miso records one second and gives you a classification. Open the **Model lab** to explore the model or follow your recording through it.

There’s also a little Easter egg: click the terminal button and enter `MISO.EXE`. Have fun with it.

## A note on accuracy

I only had time to record myself making each animal noise three times—nine training recordings total. Overfitting is definitely a problem here: the model gets the original recordings right, but that doesn’t mean it generalizes to new ones.

In my own testing, it very rarely predicts “meow” on new recordings, even when I’m meowing super hard. “Moo” and “woof” seem to work much better for me. That’s a limitation of this little experiment, and the low training loss doesn’t tell the whole story.
