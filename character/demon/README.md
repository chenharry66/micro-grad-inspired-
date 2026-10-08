# Miso demon character

`miso.blend` is the editable source; `miso.glb` is the browser asset. Both belong in the commit.

Export with the installed Blender:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --python character/demon/export.py
```

The source contains the skinned mesh, animations, and facial shape keys. `SeatContact` and `ClawContact_L/R` are runtime attachment markers. The runtime uses `Tear page`, `Pounce`, `Punch`, and `Seated idle`; other authored clips remain available in the source.

Activate with `MISO.EXE` in the footer terminal. Check the dark eyes/teeth opening, grin and teleport, three distinct impacts, final disappearance, and restoration. Escape, resizing, and leaving the tab stop audio and restore the page immediately. Reduced motion stays still.

Music attribution is in `web/audio/CREDITS.txt`. Impact and teleport sounds are synthesized locally using Web Audio.
