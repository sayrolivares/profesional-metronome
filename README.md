<p align="center">
  <img src="icons/favicon.svg" width="96" alt="Metronome logo">
</p>

<h1 align="center">Metronome</h1>

<p align="center">
  <em>Made for musicians, by a musician.</em><br>
  A precise, pleasant-sounding practice metronome that runs in your browser.
</p>

<p align="center">
  <a href="https://sayrolivares.github.io/professional-metronome/"><strong>Open the app</strong></a>
</p>

---

Most online metronomes give you a harsh electronic beep and little else. Metronome is built to be practiced with every day: warm, non-fatiguing sounds, rock-solid timing, and practice tools that help you build tempo and keep time on your own. It works on phones, tablets and computers, and there's nothing to install or sign up for.

## Features

### Timing and rhythm
- Tempo from 20 to 300 BPM: slider, ±1/5/10 buttons, typed value, arrow keys or tap tempo
- Traditional Italian tempo markings (Largo, Andante, Allegro…) that update as you go
- Any time signature, from 2/4 to 12/8 or a custom one; compound meters like 6/8 can be felt as six pulses or two dotted beats
- Accent pattern with four levels per beat (strong, medium, normal, silent), and patterns you can save
- Subdivisions: eighths, triplets, sixteenths, sextuplets and thirty-seconds, with each pulse accented or muted individually
- Straight, swing, shuffle and dotted feel

### Sound
- Ten sounds synthesized in the browser: soft and warm woodblock, muted and felt piano, soft click, rim click, marimba, bell, analog pulse and traditional tick
- A separate sound for beats, accents, subdivisions and polyrhythm
- Individual levels, stereo position and optional room ambience

### Practice tools
- **Count-in** of 1, 2, 4 or 8 bars
- **Silent bars:** the click drops out for a few bars so you can check your inner pulse
- **Tempo trainer:** speeds up (or slows down) by a step every few bars until it reaches a target
- **Progressive practice:** a list of tempos, each held for a set time, with automatic changes between them
- **Polyrhythms:** 2:3, 3:2, 3:4, 4:3, 4:5 or any custom ratio
- **Practice timer** with a gentle chime when time is up

### Sessions
- Save complete setups as presets, then load, copy, rename or update them
- A practice log with duration, start and end tempo, meter and settings for every session
- Simple statistics: total time, days practiced this week, streak, average session

### Extras
- A440 tuning reference (430–450 Hz) and a frequency generator with note names. These play reference tones; they aren't tuners.
- Six color palettes, each in light and dark, plus an automatic mode that follows your device
- American (quarter note) or British (crotchet) note names, or both
- Simple and Advanced modes, help hints on every control, and full keyboard shortcuts
- Installable to your phone or tablet home screen

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| Space | Play / pause |
| ↑ / ↓ | Tempo ±1 (Shift ±5, Alt ±10) |
| T | Tap tempo |
| R | Stop and reset |
| M | Mute / unmute |
| H | Help hints on / off |

## Privacy

Metronome collects nothing. There are no accounts, analytics, trackers, cookies or ads, and the app makes no requests to third parties: the typeface is bundled and every sound is generated on your device. Your settings, presets and practice log stay in your browser's local storage. The project is currently free and not for profit. See [privacy.html](privacy.html) for the full statement.

## How it works

The app is plain HTML, CSS and JavaScript with no framework, no build step and no dependencies.

Timing uses the Web Audio API clock with a short look-ahead scheduler, driven by a Web Worker so it stays steady even when the window is in the background. Tempo changes take effect within about a tenth of a second, without skipped or doubled clicks. The visuals follow the audio clock rather than running their own timer.

## Feedback

Found a bug or have an idea? Get in touch on [Instagram](https://www.instagram.com/sayrolivares/) or [X](https://x.com/sayrolivares) (@sayrolivares), or open an issue here.

## Credits

Designed and built by [@sayrolivares](https://x.com/sayrolivares). The typeface is [Outfit](https://github.com/Outfitio/Outfit-Fonts), under the SIL Open Font License (see `fonts/OFL.txt`).