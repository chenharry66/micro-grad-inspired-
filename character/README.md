# Miso character study

A provisional mixed-animal mascot, built from editable SVG groups. This is a standalone design and motion playground; it does not run training, access the microphone, or perform inference.

From the repository root:

```sh
python3 -m http.server 8000 --directory character
```

Open http://localhost:8000. Select a reaction using the four buttons. The preview needs HTTP because it loads the SVG from a separate file.

- `creature.svg`: reusable vector artwork, with named head, ears, eyes, arms, tail, milk, and sparkle groups. Opens independently in a browser or vector editor.
- `motion.css`: idle breathing/blinking, dog tail wag, cat paw grooming, and cow milk reveal. Respects reduced-motion preferences.
- `index.html` and `preview.js`: disposable review playground with manual state controls and a pause button.

## Future integration

Inline the SVG inside an element with `data-state="idle"` and include `motion.css`. Change that attribute to `dog`, `cat`, or `cow`. The preview also exposes `window.characterPreview.reactToLabel('Moo')` and `setState('idle')`. Model labels map exactly to the existing training labels: Meow → cat, Woof → dog, Moo → cow.

Wag and grooming repeat while selected. The milk glass enters once on selection and stays held until another state is chosen. Pause freezes ongoing CSS animations; choosing a different state can still change the pose. Reduced motion uses still poses, including the milk glass.

The name, colors, silhouette, and motion timing are draft choices. No third-party assets, fonts, libraries, or accounts are required.

## Cat motion study

The cat reaction keeps the original round, front-facing artwork. A 3.6-second cycle lifts one paw from the shoulder, tilts the head slightly toward it, extends and retracts a small tongue twice, then lowers the paw. Tongue and head share their transform and timing; the tongue is layered above the paw to make contact visible. A delayed ear flick and slow tail sway soften the recovery. Reduced motion holds the raised paw with the tongue hidden. Dog and cow motions remain unchanged.

The original artwork was authored directly as SVG paths for this project, not sourced from a character library or an image generator. It can be replaced by another original design or adapted from a user-provided reference.

The cow reveal morphs the resting paw into the extended arm over 0.85 seconds while the full-size glass moves outward from its side. There is no group scaling or ground-up entrance; the shoulder stays anchored. The tail eases aside at the same pace.
