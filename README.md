<p align="center">
  <img src="icons/favicon.svg" width="96" alt="Tuner &amp; Metronome logo">
</p>

<h1 align="center">Tuner &amp; Metronome</h1>

<p align="center">
  <em>Made for musicians, by a musician.</em><br>
  A precise chromatic tuner and a pleasant-sounding practice metronome that run in your browser.
</p>

<p align="center">
  <a href="https://sayrolivares.github.io/professional-metronome/"><strong>Open the app</strong></a>
</p>

---

Open the app and the tuner is ready: press start, allow the microphone, play a string. The needle, the note and a plain "tune up / tune down / in tune" tell you what to do, and the frequency is always on screen. The metronome is one tap away. Both work on phones, tablets and computers, with nothing to install or sign up for.

## Tuner

### Tuning
- Chromatic: detects all twelve notes from B0 (31 Hz, a 5-string bass) up to C8, not just guitar strings
- Shows the note and octave, the measured frequency in Hz, the target frequency, the difference in Hz and in cents
- A steady needle with a tolerance zone, and words and arrows as well as colour, so the state is clear at a glance
- Auto mode follows the string you play (and shows plain note names rather than guess); Manual mode tunes the string you pick
- Strings you've brought in tune get a mark, so you can work through the instrument one string at a time

### Instruments
- Guitar: standard, Drop D, half step down, D standard (whole step down), Drop C, Open D, Open G, Open E, Open C, DADGAD, 7-string
- Bass: 4, 5 and 6-string standard, Drop D, half step down, 5-string Drop A
- Violin, viola, cello, double bass (orchestral, solo, 5-string), ukulele (high G, low G, D tuning, baritone), mandolin and 5-string banjo
- Your own tunings for any instrument with up to 12 strings, saved in your browser

### Advanced mode
- Reference pitch: A4 from 400 to 480 Hz in 0.1 Hz steps, with 415, 432, 440, 442 and 443 one tap away
- Tune to any frequency you type, measured in cents
- Tolerance of ±1, 2, 3, 5 or 10 cents
- A full measurement table: measured and target frequency, difference, cents, nearest note, reference, confidence and level
- A reference tone (any note or frequency, sine or triangle, adjustable volume)
- A live view of the signal, a sensitivity setting for quiet instruments or loud rooms, sharp or flat note names, a microphone picker, and a list of the notes you've tuned this session

## Metronome

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

## Everywhere
- Seven color palettes, each in light and dark, plus an automatic mode that follows your device. The default, Luthier, is walnut, brass and ice blue.
- Simple and Advanced modes, help hints on every control, and full keyboard shortcuts
- American (quarter note) or British (crotchet) note names in the metronome
- Installable to your phone or tablet home screen

## Keyboard shortcuts

| Key | Tuner | Metronome |
| --- | --- | --- |
| Space | Start / stop listening | Play / pause |
| ← / → | Previous / next string | |
| ↑ / ↓ | | Tempo ±1 (Shift ±5, Alt ±10) |
| T | | Tap tempo |
| R | | Stop and reset |
| M | | Mute / unmute |
| H | Help hints on / off | Help hints on / off |

## Privacy

The app collects nothing. The tuner listens only while you have pressed start; your instrument's sound is analysed on your device as it arrives and is never recorded, stored or sent anywhere. The microphone is released when you stop, switch to the metronome, hide the page, or after five minutes without a note. There are no accounts, analytics, trackers, cookies or ads, and the app makes no requests to third parties: the typefaces are bundled, every sound is generated on your device, and the page tells your browser to refuse connections to other sites. Your settings, tunings, presets and practice log stay in your browser's local storage. The project is currently free and not for profit. See [privacy.html](privacy.html) for the full statement.

## How it works

The app is plain HTML, CSS and JavaScript with no framework, no build step and no dependencies.

The tuner reads pitch with the McLeod Pitch Method, a time-domain method that measures how the waveform repeats rather than looking for the loudest frequency, so it isn't fooled by strong harmonics or by the weak low fundamentals that phone microphones pick up. Readings are steadied with a level gate that adapts to the room, a median filter and gentle smoothing. See [docs/TUNER.md](docs/TUNER.md) for the full design, the maths and the test suite.

Metronome timing uses the Web Audio API clock with a short look-ahead scheduler, driven by a Web Worker so it stays steady even when the window is in the background. Tempo changes take effect within about a tenth of a second, without skipped or doubled clicks. The visuals follow the audio clock rather than running their own timer.

## Development

```
npx serve .            # run locally (the microphone works on localhost)
npm test               # unit and engine tests, plain node
npm run test:browser   # end-to-end in Chrome with a fake microphone (needs Playwright)
```

The site deploys to GitHub Pages as it is: *Settings › Pages ›* deploy from the `main` branch, root folder. Paths are relative, so it works under a project URL. Details, browser notes and how to add an instrument or a tuning are in [docs/TUNER.md](docs/TUNER.md).

## Feedback

Found a bug or have an idea? Get in touch on [Instagram](https://www.instagram.com/sayrolivares/) or [X](https://x.com/sayrolivares) (@sayrolivares), or open an issue here.

## Credits

Designed and built by [@sayrolivares](https://x.com/sayrolivares). The typefaces are [Outfit](https://github.com/Outfitio/Outfit-Fonts) and [Fraunces](https://github.com/undercasetype/Fraunces), under the SIL Open Font License (see `fonts/OFL-Outfit.txt` and `fonts/OFL-Fraunces.txt`).
