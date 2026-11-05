# Testing the tuner by hand

The automated tests (`npm test`, `npm run test:recordings`, `npm run test:browser`) check the maths, synthetic strings, 162 real recordings through simulated microphones, and the page in Chrome. They cannot hold a real phone to a real guitar. This procedure does, and is written so that two people, or the same person a month apart, get comparable results.

Allow about 30 minutes per device.

## What you need

- The instrument, **freshly tuned with a reference you trust**: a strobe tuner, a clip-on tuner, or GuitarTuna. Write down what the reference says for each string (for example "E2 −1 ¢"), so differences are measured against it, not against an assumption.
- The phone, tablet or computer under test, on the **https** address of the app (the microphone is blocked on plain http, except on `localhost`).
- A quiet room, and a way to make it noisy (a fan, a TV at speaking volume, a recording of a café).
- The results table at the bottom of this page (copy it into a note).

## Before you start

1. Note the **device, operating system and browser with versions**, for example "iPhone 13, iOS 18.1, Safari"; "Pixel 7, Android 15, Chrome 131"; "MacBook Air M2, macOS 15, Chrome 131".
2. Open the app, switch to **Advanced** (top of the page), and open **Microphone** in the side panel.
3. Press **Start** and allow the microphone. Under Microphone, write down the **Sound processing** line, e.g. "Raw sound: echo cancellation, noise suppression and automatic gain off" or "This browser kept noise suppression on". If any processing stayed on, note it: it explains a lot of what follows.
4. Write down the **Sample rate** shown under Signal.
5. Keep the defaults: guitar Standard, Auto, A4 = 440 Hz, tolerance ±3 ¢, sensitivity Normal.

## Position

Hold or stand the device **30–50 cm** from the sound hole (acoustic) or the amplifier (electric), microphone facing the instrument. Phones usually have the microphone at the bottom edge. Keep the position the same for every step.

## Tests

For each test, pluck **one open string** with a normal, medium stroke, unless the step says otherwise, and watch for 3 seconds. Repeat each string **three times**.

### 1. Detection and accuracy, quiet room (all six strings)

Strings: E2 (82.41 Hz), A2 (110.00 Hz), D3 (146.83 Hz), G3 (196.00 Hz), B3 (246.94 Hz), E4 (329.63 Hz).

Record for each:
- **Found?** Did the right note and octave appear? (E2, not E3.)
- **Time to first reading:** instant (< ¼ s), short (< ½ s) or slow.
- **Cents** shown once it has settled, compared with your reference. A difference of 1–2 ¢ is normal; through a phone microphone the low strings may read up to 3–4 ¢ sharp late in their ring, because their upper partials are slightly sharp (see `docs/TUNER.md`, Known limitations).
- **Steadiness:** how much the cents figure moves while the string rings (e.g. "±0.5 ¢").
- **Any wrong note shown, even briefly** (an octave, or another note). This is the most important thing to catch: write down which and when (attack, middle, end).

### 2. The low E specifically

1. Pluck E2 **softly** (as quietly as you would to check tuning between songs). Found? Wrong octave at any time?
2. Pluck E2 **hard**. Does the reading start sharp and then settle? Does "In tune" appear only after it settles?
3. Let E2 ring until it dies. Does **"Pluck again"** appear before the reading starts to wander? Does the last reading stay visible, dimmed?

### 3. Slightly out of tune

1. Detune the A string about **10 ¢ flat** (check with the reference). Does the tuner say "Tune up" with about −10 ¢? The reference and this tuner should agree within ±2 ¢.
2. Tune it up slowly while it rings. Does the needle follow without lagging behind? Does "In tune" appear once within ±3 ¢, and stay without flickering while the pitch is steady?
3. Set the tolerance to **±1**, then **±10**, and repeat: "In tune" should appear only within the chosen tolerance.

### 4. Noisy room

Turn on the noise source at a level where you can still hear the guitar clearly from where the phone is.
1. Repeat test 1 for E2, A2 and E4. Note whether each is found, its cents, and any wrong notes.
2. With nothing playing, does the tuner stay quiet (or say "Too noisy to read"), rather than showing a note?

### 5. Other instruments (if available)

Bass (E1 41.2 Hz, A1, D2, G2), violin, viola, cello, ukulele: select the instrument in the tuning picker and repeat test 1. For a 5-string bass, the low B (30.87 Hz) is the hardest note; a clip-on microphone may be needed on a phone.

### 6. Switching tools

1. Start the metronome, then switch to the Tuner: the click must **stop**. Switch back to the Metronome: it must be **stopped** (not resumed).
2. Start listening in the Tuner, switch to the Metronome: the browser's microphone indicator must go **off**. Switch back: the tuner must **not** start listening by itself.

### 7. Comparison with another tuner

With the same position and strings, pluck each string and read the cents on this tuner and on the reference (GuitarTuna or a clip-on) **at the same time** (or one after another for the same pluck strength). Note which one finds the note first and whether they agree.

## Results table

Copy this, one block per device:

```
Device / OS / browser:
Sound processing line:
Sample rate:
Room: quiet / noisy (what noise)

String | found 3/3 | first reading | cents vs reference | steadiness | wrong notes | Pluck again ok
E2     |           |               |                    |            |             |
A2     |           |               |                    |            |             |
D3     |           |               |                    |            |             |
G3     |           |               |                    |            |             |
B3     |           |               |                    |            |             |
E4     |           |               |                    |            |             |
E2 soft / hard:
A2 −10 ¢, tuning up (lag, flicker):
Tolerance ±1 / ±10:
Noisy room E2 / A2 / E4:
Switching tools (metronome stops, mic off, no auto-restart):
Compared with (reference tuner):
Notes:
```

## When something fails

Note the device, the step, the string and what was shown, and if possible take a screen recording. In Advanced, the **Signal** panel (level, clarity, confidence, window) and the **Measurements** table are the most useful things to capture. Send it through the app's feedback button (Instagram or X, @sayrolivares).
