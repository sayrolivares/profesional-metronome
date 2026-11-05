# The tuner: how it works

This is the technical guide to the tuner added in version 2.0: architecture, the audio pipeline, the pitch-detection algorithm, the maths, presets, privacy, deployment, testing and known limitations. The metronome is described in the README and in the comments of `js/engine.js`.

## Contents

1. [Architecture](#architecture)
2. [Audio pipeline](#audio-pipeline)
3. [Pitch detection](#pitch-detection)
4. [From a reading to the screen](#from-a-reading-to-the-screen)
5. [Mathematical conventions](#mathematical-conventions)
6. [Instruments and tunings](#instruments-and-tunings)
7. [Microphone permission](#microphone-permission)
8. [Privacy](#privacy)
9. [Deployment (GitHub Pages and Vercel)](#deployment)
10. [Testing](#testing)
11. [Browser compatibility](#browser-compatibility)
12. [Known limitations and trade-offs](#known-limitations-and-trade-offs)
13. [Deferred to later releases](#deferred-to-later-releases)

## Architecture

The tuner follows the metronome's conventions: plain HTML, CSS and JavaScript, no framework, no build step, no dependencies. Each file is a small script that adds one module to the shared `MN` namespace and works both in the browser and in node (for the tests). The audio engine never touches the page, and the page never computes pitch.

```
 microphone ─▶ tuner-audio.js ─▶ tuner-engine.js ─▶ pitch.js ─▶ tuner-model.js ─▶ tuner-ui.js ─▶ page
              (AudioInput)      (loop, lifetime)   (detector,    (targets, cents,   (draws, binds
                                                    tracker)      strings, history)  controls)
                                        ▲                                ▲
                          tuner-store.js (settings)       notes.js (maths) · tunings.js (presets)
```

| File | Role | Pure? |
| --- | --- | --- |
| `js/notes.js` | Note names, frequencies, cents, reference pitch, temperament table, number formatting | yes |
| `js/pitch.js` | `PitchDetector` (McLeod Pitch Method) and `PitchTracker` (gating, smoothing, hold) | yes |
| `js/tunings.js` | Instrument presets, validation and the custom tuning library | yes (storage injected) |
| `js/tuner-store.js` | Tuner settings, validated on load and on every change | yes (storage injected) |
| `js/tuner-model.js` | Reading + settings → note, target, cents, in tune, auto string, string progress, history | yes |
| `js/tuner-audio.js` | `AudioInput` (getUserMedia, Web Audio graph, devices, permission) and `ReferenceTone` | browser APIs injected |
| `js/tuner-engine.js` | Runs analysis ~20×/s; owns when the microphone is on | timers and document injected |
| `js/tuner-ui.js` | The tuner page: gauge, readouts, strings, Advanced controls, tuning dialog | DOM |
| `js/views.js` | Tuner / Metronome switch; the tuner opens first | DOM |

Everything marked pure is unit-tested in node. The browser-facing modules take their browser objects as constructor options, so the tests drive them with fakes.

**Shared with the metronome:** the header, dialogs (`js/dialogs.js`), help hints (`js/help.js`), themes and palettes (`js/themes.js`), the toast, the Simple/Advanced switch and the app's identity (`js/version.js`). App-wide preferences (theme, palette, help hints, mode) stay in the metronome's store; the tuner's settings live under their own key, `tuner.v1.settings`, so neither tool can corrupt the other.

## Audio pipeline

```
getUserMedia ──▶ MediaStreamSource ──▶ high-pass 22 Hz ──▶ AnalyserNode ──▶ gain 0 ──▶ destination
 (echo cancel,                          (removes rumble     (holds the latest
  noise suppression,                     and DC drift)       ~0.35 s of samples)
  auto gain: OFF)
                                    every 50 ms: copy the last 4096 or 8192 samples ─▶ detector
```

- **Voice processing is switched off.** Echo cancellation, noise suppression and automatic gain control are designed for speech: they treat a sustained tone as noise, smear attacks and pump the level. A tuner needs the raw signal.
- **The AudioContext is created after permission is granted.** On iOS the hardware switches to its recording sample rate when the microphone opens; a context created earlier can report the wrong rate, which would put every reading about 1.5 semitones off. If the track's rate and the context's still differ, the context is recreated at the track's rate.
- **The analyser is only a buffer.** Its FFT is not used. The engine copies the newest samples out on a timer, not on animation frames, so analysis cost doesn't depend on the display's refresh rate.
- **The silent gain to the destination** keeps the graph running in every browser without playing the microphone back.
- **Analysis window:** about 170 ms (8192 samples at 44.1/48 kHz) while the note is low or unknown, halved once the note is above 160 Hz, or from the start for instruments whose lowest string is above 160 Hz (violin, ukulele, mandolin). The lowest supported string, B0 at 30.9 Hz, has a 32 ms period, so the long window holds five periods.
- **Rate:** 20 analyses per second. On the test machine one long window costs about 1.5 ms (the short one about 0.5 ms), around 3% of one core.

## Pitch detection

### Why not the biggest FFT peak

On low strings the strongest spectral component is often the 2nd or 3rd harmonic, and phone microphones roll off below about 100 Hz, so the fundamental of a bass's low E (41 Hz) can be almost absent. "Largest FFT bin" then reads an octave or a twelfth high. FFT bins are also too coarse: at 48 kHz with 8192 points they are 5.9 Hz apart, which is more than a semitone at E1.

### McLeod Pitch Method

The detector (`js/pitch.js`) uses the McLeod Pitch Method (MPM) from McLeod & Wyvill (2005), a time-domain method in the same family as autocorrelation and YIN:

1. **Normalised square difference function (NSDF).** For every lag τ, `n(τ) = 2·r(τ) / m(τ)`, where `r` is the autocorrelation and `m(τ) = Σ (x_j² + x_{j+τ}²)`. The value is 1 for a perfectly periodic signal at its period, near 0 for noise. `r(τ)` is computed with an FFT (zero-padded to 2N, so it isn't circular): O(N log N) instead of O(N²).
2. **Key maxima.** The highest point of each positive lobe of the NSDF, after the lobe around lag 0.
3. **Choice.** The first key maximum whose height is at least 0.9 × the highest one. Taking the *first* such peak, not the highest, prevents octave-down errors (twice and three times the period score almost as well as the period itself). Requiring it to be close to the highest prevents octave-up errors on strong harmonics.
4. **Sub-sample precision.** A parabola through the peak gives a fractional period. Peak heights are compared after interpolation: for the highest notes (C8 has a period of 11.5 samples) the raw sample nearest the true peak can look lower than the peak at twice the period, which would cause an octave error.
5. **Refinement for high notes.** The period is re-measured from the peak at 2×, 3×… up to 8× the period (whichever is the furthest still clear) and divided back. This multiplies the precision of short periods.
6. **Clarity.** The NSDF height at the chosen peak, 0–1, is the confidence of the reading.

Before the NSDF, the buffer's mean is removed. If a slow trend still keeps the NSDF positive at every lag (a bumped phone, wind), the frame is analysed again with a linear trend removed. That isn't done by default because detrending a window that holds only a few periods of a low note bends it by up to 1.5 ¢.

YIN was the main alternative. It performs similarly; MPM was chosen because its clarity value is a ready-made, well-behaved confidence measure, and its peak-picking rule handles harmonic-rich string tones without a tuned absolute threshold. Both are cheap enough here. AudioWorklet was considered and not used: copying from an AnalyserNode 20 times a second is simpler, works in every browser that supports Web Audio, and keeps heavy maths off the real-time audio thread.

### Tracker

The tracker turns one detection per frame into a steady reading:

- **Level gate.** A frame quieter than the gate is ignored. The gate is the higher of a fixed level (−66, −58 or −48 dBFS for the High, Normal and Low sensitivity settings) and the measured noise floor + 9 dB. The noise floor is followed whenever no note is sounding: it falls quickly and rises slowly, so a fan raises the gate over a few seconds but a pluck never does.
- **Confidence thresholds.** Clarity 0.90 to start showing a note, 0.80 to keep following it.
- **Attack rejection.** A level jump of more than 10 dB marks a new pluck; that frame is skipped (plucked strings start sharp and noisy).
- **Median and debounce.** A median over the last five frames removes stray readings. A change of more than 60 ¢ is treated as a new note only once two frames agree on it.
- **Adaptive smoothing.** Exponential smoothing in cents, gentle when the pitch is settled (needle stays still) and quick when it moves (no lag while tuning).
- **Octave continuity.** If the detector's choice is an octave away from the current note but it also found the current note's period almost as clearly, the current note wins. Before a note is established, the string being tuned (Manual mode or a typed frequency) breaks octave ties the same way.
- **Hold.** When the note dies away, the last reading stays on screen, dimmed, for 1.4 s.
- **States:** `quiet` (below the gate), `searching`, `noisy` (loud but not periodic for 0.7 s), `pitch`, `hold`.

## From a reading to the screen

`js/tuner-model.js` decides what the reading means:

- **Target, in order of precedence:** a typed frequency (Advanced) › the chosen string (Manual) › the string being played (Auto, only when clear) › the nearest note.
- **Auto string detection** picks the string nearest in cents, but only if it is within 400 ¢ and beats the runner-up by at least 150 ¢. Between two strings it shows plain note names rather than guess. Once on a string it stays there until another is 60 ¢ closer, so tuning a string past the midpoint doesn't make it jump.
- **Note name hysteresis:** the shown note changes only once the pitch is 58 ¢ from it (50 is the midpoint), so the name doesn't flicker at the boundary.
- **In tune** means |cents| ≤ the tolerance (±1, 2, 3, 5 or 10 ¢; default ±3), inclusive. A string held in tune for 0.6 s is marked done. Changing the tuning, the reference pitch or the temperament clears the marks.
- **Recent notes** keeps the last 12 notes held in tune, in memory only.

The page never relies on colour alone: the status line says "Tune up", "Tune down" or "In tune" with an arrow or a check, the needle shows the direction, ♭ and ♯ light up at the ends of the scale, and a screen reader hears the note and direction when they change (at most every 1.5 s).

## Mathematical conventions

- **Note names:** scientific pitch notation. MIDI 69 = A4; MIDI 60 = C4, middle C. Octave numbers change at C: B3 is followed by C4. In-between notes are spelled with sharps by default (C♯); flats can be chosen in Advanced, and tunings written with flats (such as half step down) always show flats.
- **Reference pitch:** the frequency of A4, 440 Hz by default, adjustable from 400 to 480 Hz in 0.1 Hz steps. A4 = 442 Hz is still A4: the reference moves every target, never the names.
- **Equal temperament:** `f = A4 × 2^((m − 69) / 12)` for MIDI note m.
- **Cents:** `cents = 1200 × log2(f_measured / f_target)`. 100 cents = 1 semitone.
- **Difference in hertz:** `f_measured − f_target`, shown alongside the cents.
- **Display:** frequencies with 2 decimals (3 in the measurement table), cents with 1. Values are rounded only when shown; `−0.0` is never displayed; the minus sign is a real minus (−).
- **Temperaments** are offsets in cents from equal temperament, per pitch class, relative to a root (`TEMPERAMENTS` in `js/notes.js`). Only equal temperament ships, and the interface shows it as a fixed value, not as a menu with options that don't work. To add one (for example just intonation, Pythagorean or quarter-comma meantone), add an entry with an `offset(pc, rootPc)` function and expose it in the UI; `nearest()` already checks neighbouring notes so offsets are handled.

Worth knowing: violinists and cellists usually tune their open strings in pure fifths, which differs slightly from equal temperament (a violin's E5 is 662.25 Hz in equal temperament at A4 = 442, 663 Hz as a pure fifth above A). A "pure fifths" temperament for bowed strings would be a natural first addition.

## Instruments and tunings

Presets live in one table, `INSTRUMENTS` in `js/tunings.js`. Nothing else in the app knows about any instrument.

```js
{ id: 'violin', name: 'Violin', blurb: 'G D A E', tunings: [
  { id: 'violin-standard', name: 'Standard', notes: 'G3 D4 A4 E5' },
] },
```

Each tuning has an `id` (unique across all presets), a `name`, its strings in `notes` (lowest first as they sit on the instrument; re-entrant tunings such as ukulele keep their physical order), and optionally an `alias` (another common name), a `meta` note shown in the picker, and `flats: true/false` to force the spelling. Target frequencies are not stored: they are derived from the note, the reference pitch and the temperament, so they are always right for the current A4.

**To add a tuning:** add an object to the instrument's `tunings` list. **To add an instrument:** add an object with an `id`, `name`, `blurb` and its `tunings`. Then run `npm test`: the tests check that every note parses, every string stays inside the detector's range (25 Hz–4.2 kHz) at any allowed reference pitch, and every id is unique.

**Custom tunings** are created in the app (the tuning picker's *My tunings*, or Advanced › My tunings). Notes are typed as `E2 A2 D3`, with `#`/`♯` and `b`/`♭` accepted and normalised. Validation: a name of 1–40 characters (markup and control characters removed), 1–12 strings, each between A0 and C8 and inside the detector's range. They are stored in `localStorage` under `tuner.v1.tunings`, validated again when loaded, and limited to 50. **Restore defaults** resets the tuner's settings but keeps custom tunings.

## Microphone permission

- The microphone is requested only when Start is pressed, never on page load.
- Before that, the page explains that sound is analysed on the device and never recorded. The side panel shows the permission state where the browser exposes it (Permissions API): allowed, asks when you press Start, or blocked.
- Failures get specific messages and a Try again button: blocked (with the steps for the browser in use), no microphone, microphone busy (a call or another app), insecure page (http), unsupported browser.
- A remembered input device that has disappeared falls back to the default one. If the device is unplugged while listening, the tuner stops and says so.
- When several inputs exist, a menu lets you choose one (names appear only after permission is granted, a browser privacy rule).
- While listening, the app asks the browser to keep the screen on (Screen Wake Lock), so a phone on a music stand doesn't sleep. It is released when listening stops.

**The microphone is released** (every track stopped, the browser's "in use" indicator off, the AudioContext closed) when Stop is pressed, when switching to the metronome, when the page is hidden or closed, after five minutes without a note, or if the device disappears. If listening stopped because the page was hidden, it resumes when the page is shown again.

## Privacy

What the tuner processes, and where:

| Data | Where it goes |
| --- | --- |
| Microphone audio | Analysed in the browser's memory, a window at a time. Never recorded, stored, uploaded or sent. |
| Pitch readings | Shown on screen. The last 12 in-tune notes are kept in memory while the page is open. |
| Settings and custom tunings | `localStorage` in the visitor's browser only. |
| Device names | Shown in the microphone menu; the chosen device's id is kept in `localStorage`. |

There are no analytics, ads, cookies, accounts or third-party scripts. Typefaces are self-hosted. A Content-Security-Policy in `index.html` (`connect-src 'self'` and friends) makes the browser refuse connections to other sites, and the browser test fails if the page makes any request outside the site. The host (GitHub Pages) receives the usual request information when the page loads; the privacy page says so. If analytics or anything else that collects data is ever added, update the text between `privacy:start` and `privacy:end` in **both** `index.html` and `privacy.html` (the test checks they match), and the CSP.

## Deployment

The site is static and needs no build. All paths are relative (`css/…`, `js/…`, `./`), so it works at a domain root and under a project path such as `https://sayrolivares.github.io/professional-metronome/`. The browser test serves it under `/professional-metronome/` and fails on any missing file.

**GitHub Pages**

1. Push the repository to GitHub.
2. *Settings › Pages › Build and deployment*: Source **Deploy from a branch**, branch `main`, folder `/ (root)`.
3. Wait for the deployment, then open the Pages URL. It is served over HTTPS, which the microphone requires.

Included for Pages: `.nojekyll` (serve files as they are, skip Jekyll) and `404.html`, which is self-contained because Pages serves it for missing paths at any depth (relative links to `css/` would break there) and works out the link back to the project root from the address.

**Vercel** (optional): `vercel.json` sets security headers. Its `Permissions-Policy` now allows the microphone for the site itself (`microphone=(self)`); the previous `microphone=()` would have blocked the tuner entirely on Vercel. GitHub Pages ignores this file.

**Local development:** `npx serve .` (or any static server) and open `http://localhost:…`. Browsers allow the microphone on `localhost` without HTTPS. Opening `index.html` as a file works for the metronome, but browsers block the microphone on `file://` pages.

Deployment checklist: open the live URL on a phone, press Start, allow the microphone, play a string; check that the version in About matches `js/version.js`; check the browser's console for errors.

## Testing

```
npm test               # unit and engine tests in node (no dependencies)
npm run test:browser   # end-to-end in Chrome (needs Playwright)
```

| Suite | Covers |
| --- | --- |
| `tests/notes.test.js` | Note ↔ frequency, cents, reference pitch, octave boundaries, round trips A0–C8 at any reference, parsing, invalid and non-finite input, formatting |
| `tests/pitch.test.js` | Detector on synthetic signals: sines B0–C8 (±0.1 ¢), string timbres, missing and weak fundamentals, dominant upper harmonics, plucked strings (Karplus–Strong, ±0.1 ¢), decaying notes, noise at 10 dB SNR, pure noise, silence, drift, vibrato, 44.1/96 kHz, a sweep of every note B0–C8 that fails on any octave error, cost per frame. Tracker: smoothing, gate, hold, noisy, debounce, octave continuity, string hint, attack skip, adaptive noise floor |
| `tests/tunings.test.js` | Required instruments and their notes, preset validity and range, validation messages, name sanitising, custom library CRUD and persistence, corrupt and hostile storage, settings store |
| `tests/tuner-model.test.js` | Targets, cents, tolerance boundaries, reference pitch, auto string detection (and refusal to guess), manual strings, typed frequency, note hysteresis, spelling, string progress, history |
| `tests/tuner-engine.test.js` | Permission granted / denied / no microphone / busy / unsupported / insecure, track and context release, stop during the permission prompt, hidden page, unplugged device, idle stop, window size, iOS sample-rate correction, devices, reference tone |
| `tests/browser.test.js` | Real Chrome with a fake microphone playing generated recordings: E2 12 ¢ flat, A2 in tune, a 31 Hz low B, A4 at 442 Hz with both reference pitches, a typed target, silence; microphone release on Stop and on leaving the tuner; denied and missing microphone; instrument picker and reload; custom tuning create/validate/delete; Simple/Advanced; feedback, About and privacy; metronome regression; layouts from 320 px to 1440 px with no horizontal overflow; no console errors, CSP violations, third-party requests or missing files |

The existing metronome suites (`rhythm`, `engine`, `terms`, `themes`, `privacy`) still run and pass. The themes test now also checks the "in tune" colour's contrast in every palette.

To run the browser tests: `npm i -D playwright && npx playwright install chromium`, then `npm run test:browser`. Set `CHROME_PATH` to use an installed Chrome instead. Screenshots land in `tests/screenshots/`; the generated recordings are written to a temporary folder and removed.

## Browser compatibility

Tested: **Chrome 153 (desktop, Linux)**, automated, including real microphone capture through Chrome's fake audio device, at phone, tablet and desktop sizes. Nothing else has been tested on real hardware yet.

Expected to work but **not yet tested**: Chrome and Edge on Windows and macOS, Chrome on Android, Firefox, Safari on macOS, Safari on iPhone and iPad (iOS 16.4 or later). The APIs used (getUserMedia, AudioContext, AnalyserNode with `getFloatTimeDomainData`, BiquadFilterNode) are supported in all of them; the code avoids AudioWorklet and newer features, and falls back where something is missing (byte samples if float samples aren't available; no wake lock where unsupported).

Known platform notes:

- **iOS Safari:** the microphone needs HTTPS and a tap. If iOS suspends the audio, the tuner shows a Continue button (one tap resumes). While the microphone is open, iOS routes sound in "play and record" mode, so the reference tone may be quieter or come from the earpiece; stop listening to hear the tone at full volume. The iOS ring/silent switch can mute the tone. The app sets the Audio Session type on Safari 17+ to reduce these effects.
- **All browsers:** the microphone is blocked on `http://` pages (except `localhost`) and on `file://`.
- **Laptop and phone microphones** roll off the lowest fundamentals (below ~80–100 Hz). The detector reads pitch from the harmonics' periodicity, so low strings still work, but a clip-on or USB microphone gives steadier readings for double bass and 5-string bass.

## Known limitations and trade-offs

- **One note at a time.** This is a chromatic tuner, not a polyphonic one: strumming several strings gives no reading (it says the sound is too noisy).
- **Accuracy vs. response:** the 170 ms window for low notes gives a steady reading but reacts more slowly than the 85 ms window used for high notes. A note that falls to a tenth of its level within one window reads up to ~1 ¢ off; real strings decay much more slowly.
- **Equal temperament only** for now (see conventions above).
- **Mains hum** is periodic, so with loud hum and no instrument playing the tuner can show it (50 Hz reads near G1, 60 Hz between B♭1 and B1). Low sensitivity raises the gate above it.
- **No offline mode yet:** the page needs the network to load, though nothing is fetched while tuning.
- **History is session-only** by design (no unnecessary data kept).

## Deferred to later releases

Considered and left out of 2.0 to keep the core reliable: other temperaments (pure fifths first), a strobe-style display, offline support (a service worker), per-tuning reference pitch, sweetened guitar tunings (cents offsets per string), polyphonic tuning, and calibration against an external reference.
