# The tuner: how it works

This is the technical guide to the tuner of **Metronome & Tuner**: architecture, the audio pipeline, the pitch-detection algorithm, confidence and stabilisation, the maths, presets, privacy, deployment, testing and known limitations. The tuner arrived in 2.0; version 2.1 rebuilt its audio processing after a field report that the low E string was hard to catch on a phone (what changed, and why, is in [What changed in 2.1](#what-changed-in-21)). The metronome is described in the README and in the comments of `js/engine.js`. The step-by-step manual test, for real instruments on real phones, is [docs/TUNER-TESTING.md](TUNER-TESTING.md).

## Contents

1. [Architecture](#architecture)
2. [Audio pipeline](#audio-pipeline)
3. [Pitch detection](#pitch-detection)
4. [Confidence and stabilisation](#confidence-and-stabilisation)
5. [From a reading to the screen](#from-a-reading-to-the-screen)
6. [What changed in 2.1](#what-changed-in-21)
7. [Mathematical conventions](#mathematical-conventions)
8. [Instruments and tunings](#instruments-and-tunings)
9. [Microphone permission](#microphone-permission)
10. [Privacy](#privacy)
11. [Deployment (GitHub Pages and Vercel)](#deployment)
12. [Testing](#testing)
13. [Browser compatibility](#browser-compatibility)
14. [Known limitations and trade-offs](#known-limitations-and-trade-offs)
15. [Deferred to later releases](#deferred-to-later-releases)

## Architecture

The tuner follows the metronome's conventions: plain HTML, CSS and JavaScript, no framework, no build step, no dependencies. Each file is a small script that adds one module to the shared `MN` namespace and works both in the browser and in node (for the tests). The audio engine never touches the page, and the page never computes pitch. Detection, confidence, stabilisation, note matching and drawing are separate modules, each tested on its own.

```
 microphone ─▶ tuner-audio.js ─▶ tuner-engine.js ─▶ pitch.js ─▶ pitch-confidence.js ─▶ pitch-stabilizer.js
              (input, settings   (loop, lifetime,   (detection)  (how far to trust     (gate, onsets, settling,
               read-back)         window)                         one estimate)          octave, smoothing, decay)
                                                                                                 │ reading
                                                     page ◀─ tuner-ui.js ◀─ tuner-model.js ◀─────┘
                                                            (draws)        (note, target, cents, in tune
                                                                            with hysteresis, strings)
                                        tuner-store.js (settings) · notes.js (maths) · tunings.js (presets)
```

| File | Role | Pure? |
| --- | --- | --- |
| `js/notes.js` | Note names, frequencies, cents, reference pitch, temperament table, number formatting | yes |
| `js/pitch.js` | `PitchDetector`: one buffer in, one estimate out (period, clarity, signal-to-noise, harmonicity, candidates) | yes |
| `js/pitch-confidence.js` | `assess()`: a confidence score and quality (good / fair / weak) from clarity, level above the noise floor, harmonicity and agreement | yes |
| `js/pitch-stabilizer.js` | `PitchStabilizer`: estimates → steady reading; noise floor and gate, pluck onsets, settling, octave continuity, smoothing, decay | yes |
| `js/tunings.js` | Instrument presets, validation and the custom tuning library | yes (storage injected) |
| `js/tuner-store.js` | Tuner settings, validated on load and on every change | yes (storage injected) |
| `js/tuner-model.js` | Reading + settings → note, target, cents, in tune (with hysteresis), direction, auto string, progress, history | yes |
| `js/tuner-audio.js` | `AudioInput` (getUserMedia, applied-settings check, Web Audio graph, devices, permission) and `ReferenceTone` | browser APIs injected |
| `js/tuner-engine.js` | Runs the chain ~20×/s; chooses the window; owns when the microphone is on | timers and document injected |
| `js/tuner-ui.js` | The tuner page: gauge, readouts, signal quality, strings, Advanced controls, tuning dialog | DOM |
| `js/views.js` | Tuner / Metronome switch; the tuner opens first | DOM |

Everything marked pure is unit-tested in node. The browser-facing modules take their browser objects as constructor options, so the tests drive them with fakes.

**Shared with the metronome:** the header, dialogs (`js/dialogs.js`), help hints (`js/help.js`), themes and palettes (`js/themes.js`), the toast, the Simple/Advanced switch and the app's identity (`js/version.js`). App-wide preferences (theme, palette, help hints, mode) stay in the metronome's store; the tuner's settings live under their own key, `tuner.v1.settings`, so neither tool can corrupt the other.

**Switching tools stops the one you leave.** Going to the metronome turns the microphone off (and the reference tone). Going to the tuner stops the metronome completely, as its Stop button does: the click, the bar position, count-in, trainer and practice position are reset (a run of 10 s or more goes to the practice log as usual). Neither restarts by itself when you come back.

## Audio pipeline

```
getUserMedia ──▶ MediaStreamSource ──▶ high-pass 22 Hz ──▶ AnalyserNode ──▶ gain 0 ──▶ destination
 (echo cancel,                          (removes rumble     (holds the latest
  noise suppression,                     and DC drift)       ~0.35 s of samples)
  auto gain: requested OFF,
  then read back)                   every 50 ms: copy the last 8192 (or 4096) samples ─▶ detector
```

- **Voice processing is requested off, then checked.** Echo cancellation, noise suppression and automatic gain control are designed for speech: noise suppression treats a sustained note as noise and fades it; automatic gain lifts the room as the note decays. The constraints are a request, not a guarantee, so after the microphone opens the track's actual settings are read with `getSettings()`. If any of the three is still on, one more attempt is made with `applyConstraints()`. What remains is reported (`AudioInput.processing`): the engine adapts (with automatic gain on, the end of a note is judged by confidence, not level) and Advanced › Microphone says what the browser did, e.g. "Raw sound: echo cancellation, noise suppression and automatic gain off" or "This browser kept noise suppression on…". Browsers that don't report a setting are described as such rather than assumed.
- **The AudioContext is created after permission is granted.** On iOS the hardware switches to its recording sample rate when the microphone opens; a context created earlier can report the wrong rate, which would put every reading about 1.5 semitones off. If the track's rate and the context's still differ, the context is recreated at the track's rate.
- **The analyser is only a buffer.** Its FFT is not used. The engine copies the newest samples out on a timer, not on animation frames, so analysis cost doesn't depend on the display's refresh rate.
- **The silent gain to the destination** keeps the graph running in every browser without playing the microphone back.
- **Analysis window: chosen by the instrument.** About 170 ms (8192 samples at 48 kHz) for any instrument that goes below 160 Hz (guitar, bass, cello, viola, double bass, chromatic): 14 periods of a guitar's low E, 5 of a bass's low B (30.9 Hz). It is kept even while a high string sounds: on the recordings it halved the jitter of higher notes compared with switching to a short window. Instruments that stay above 160 Hz (violin, ukulele, mandolin) use half, for a quicker response.
- **Rate and cost:** 20 analyses per second. One long window costs about 1.7 ms on the test machine (two 16 384-point FFTs plus a few direct sums), around 3.5 % of one core; expect two to four times that on a phone.

## Pitch detection

### Why not the biggest FFT peak

On low strings the strongest spectral component is often the 2nd or 3rd harmonic, and phone microphones roll off below 100–250 Hz, so the fundamental of a guitar's low E (82 Hz) can be 20–40 dB down and a bass's low E (41 Hz) almost absent. "Largest FFT bin" then reads an octave or a twelfth high. FFT bins are also too coarse: at 48 kHz with 8192 points they are 5.9 Hz apart, more than a semitone at E1.

### The detector, step by step (`js/pitch.js`)

The method is the **McLeod Pitch Method** (MPM, McLeod & Wyvill 2005), a time-domain method in the autocorrelation family, extended with a noise-floor removal and two harmonic checks:

1. **Spectrum.** The buffer (mean removed) is zero-padded to 2N and transformed with an FFT, so the autocorrelation that follows isn't circular.
2. **Noise-floor removal.** The room spreads its power across the spectrum; a note concentrates it in harmonics. In bands of 180 Hz the floor is estimated as the median power ÷ ln 2 (the mean of an exponentially distributed noise bin), interpolated between bands, and 2.5 × that is subtracted from every bin. Without this, additive noise lowers the period peak in proportion to the signal-to-noise ratio and can let a neighbouring octave win.
3. **Normalised square difference function (NSDF)** of the cleaned signal: `n(τ) = 2·r(τ) / m(τ)`, with `r` the autocorrelation (inverse FFT of the cleaned power spectrum, Wiener–Khinchin) and `m(τ) = Σ (x_j² + x_{j+τ}²)` over the overlap, measured on the signal and scaled by the share of energy kept. 1 means perfectly periodic at lag τ.
4. **Key maxima and the MPM choice.** The highest point of each positive lobe; the *first* one within 0.9 × the highest is the period. Taking the first avoids octave-down errors (2×, 3× the period score as high as the period); requiring it to be near the highest avoids octave-up errors — a period of T/2 can only score that high when the odd partials are almost absent.
5. **Harmonic checks, on the cleaned spectrum.**
   - *Shorter period?* If a candidate at 1/m of the chosen period (m = 2…6) is strong in the NSDF and the partials that only the longer period would explain (those of f that are not multiples of m, fundamental included) hold under 6 % of the energy of the shared ones, the shorter period is the note. This catches a low component (rumble, a resonance) that made a multiple of the period look best.
   - *Octave lower?* If the candidate at twice the period is nearly as periodic and its own (odd) partials hold at least 2 % of the energy of the shared ones, the lower octave is the note. This is the phone-microphone case: the fundamental is cut, the 2nd harmonic dominates, and plain MPM reads an octave up. Calibrated on the recordings: a real low string keeps this ratio above ~0.035 even in its first frames; a real higher note stays below ~0.003. Only the octave is checked; a twelfth below (3×) was wrong more often than right.
6. **Sub-sample period.** Parabolic interpolation of the peak, refined against the peaks at 2×…8× the period for short periods (high notes). On a very clean signal (clarity ≥ 0.97) the original signal's NSDF is used for this (a few lags, by direct sums), because removing the floor reshapes a pure tone's peak by ≈0.1 ¢; otherwise the cleaned NSDF, which in room noise scatters less than half as much (1.2 ¢ against 2.7 ¢ at 12 dB SNR on the low strings).
7. **Outputs.** `freq`; `clarity`, the NSDF of the *original* signal at the chosen period (the cleaned NSDF scores almost any residue as periodic, so it can't tell a buried note from a real one); `clean` (the cleaned NSDF height); `snrDb` (energy over the removed floor); `harmonicity` (share of the cleaned energy on the harmonics of the result); and the other candidate periods, each with a `support` value for the octave checks.

If a slow trend keeps the NSDF positive at every lag (a bumped phone, wind), the frame is analysed again with a linear trend removed; not by default, because detrending a window that holds only a few periods of a low note bends it by up to 1.5 ¢.

### YIN, evaluated

YIN (de Cheveigné & Kawahara 2002) was implemented on the same difference function (`d(τ) = m(τ)·(1 − n(τ))`, cumulative-mean normalised, first dip under an absolute threshold) and measured against the detector above on the same 165 real recordings, every frame on its own (no stabiliser), counting a frame right when it is within 35 ¢ of the recording's pitch:

| Microphone | MPM + checks (default) | YIN, threshold 0.15 | YIN, threshold 0.10 |
| --- | --- | --- | --- |
| Studio | 97.7 % | 94.2 % | 95.3 % |
| Phone | 96.2 % | 88.3 % | 87.3 % |
| Harsh phone | 89.8 % | 74.2 % | 70.8 % |
| Soft pluck | 82.2 % | 64.2 % | 61.2 % |
| Noisy room | 68.3 % | 46.7 % | 41.6 % |

(Single frames include the weak tail of each note, which is why the right-note rates are lower than the stabilised figures below.) In the studio and phone conditions 75–85 % of YIN's misses were octave, twelfth or two-octave errors (its fixed threshold decides between a period and its multiples on "good enough", with no look at the partials); in the noisy room about half were. Running YIN on the noise-cleaned spectrum did not close the gap. YIN stays selectable (`method: 'yin'`) for benchmarking; MPM is the default.

AudioWorklet was considered and not used: copying from an AnalyserNode 20 times a second is simpler, works in every browser that supports Web Audio, and keeps the maths off the real-time audio thread.

## Confidence and stabilisation

### Confidence (`js/pitch-confidence.js`)

One estimate is scored from independent evidence, each mapped linearly between two limits:

| Evidence | 0 at | 1 at |
| --- | --- | --- |
| Clarity (original signal) | 0.45 | 0.93 |
| Level above the room's noise floor | 3 dB | 18 dB |
| Harmonicity | 0.25 | 0.70 |

`base = clarity · (0.4 + 0.6 · level) · (0.65 + 0.35 · harmonicity)`. If the previous frame found the same pitch (within 20 ¢), or the pitch already shown (within 25 ¢), the score becomes `1 − (1 − base) · 0.55`: noise does not repeat its mistakes from frame to frame; a string repeats its pitch. Quality: good ≥ 0.7, fair ≥ 0.4, otherwise weak. This is what lets a low E in a noisy room be read (clarity 0.6–0.8, but every frame on the same pitch) while one clear-looking frame of noise is not.

### Stabiliser (`js/pitch-stabilizer.js`)

| Rule | What it does |
| --- | --- |
| Noise floor and gate | The room's level is learned while no note is shown: down quickly, up within about a second while the level stays near it, only very slowly toward anything much louder, and never from a frame that already sounds like a note (a bowed note that swells slowly is not "the room"). A note must be 3 dB above the floor (and above the Sensitivity gate: −66/−58/−48 dBFS) to start, 1.5 dB to continue; confidence does the rest. |
| Pluck onset | A level rise of 8 dB over ~150 ms is a new pluck: the frame straddling it is skipped, the history cleared. |
| Attack | For 160 ms after a pluck only clear, harmonic frames can start a note (score ≥ 0.75 without the agreement bonus, harmonicity ≥ 0.85): the thump of a pluck is not a note. |
| Settling | The reading appears at once (typically 150 ms after the pluck), but is marked unsettled for 250 ms: "In tune" is not confirmed while the attack is still sharp. At the moment it settles the attack's frames are dropped from the median. |
| Confidence | A note starts with score ≥ 0.55 (in practice: a clear frame, or two agreeing weaker ones) and continues with ≥ 0.3. |
| Octave | Frames an octave away from the note shown use the detector's candidate at the note's own period. While a note is young (first 6 frames), a lower octave is kept only if its own partials are present and never two octaves or a twelfth lower, so a note first caught too low corrects itself; once established it is kept (late in its decay a low string is mostly 2nd harmonic). Before a note is established, the string being tuned (Manual, typed frequency) or the instrument's range breaks octave ties. |
| Note change | A different note needs 2 agreeing frames, except right after a pluck. |
| Smoothing | Median of the last 5 frames, then an exponential filter whose speed depends on whether the change is real: bigger than 3× the frames' own scatter (from their median absolute deviation) → follow quickly; within it → jitter, follow slowly. A steady glide (a straight line through the last 5 frames fits far better than their scatter, slope over ~15 ¢/s: a peg being turned) is followed on the line itself, so the display doesn't trail. Measured: under 4 ¢ behind a 30 ¢/s turn; under 2.5 ¢ spread on ±3 ¢ frame jitter. Nothing is frozen. |
| Decay | When the level has fallen 45 dB below the note's loudest pitched moment, or has sunk to within 8 dB of the room after falling at least 6 dB, or no trustworthy frame has arrived for 220 ms: status `decay`. The last good reading stays on screen, dimmed, with "Pluck again", for 3 s. In the last dB above the room, noise starts to pull a reading by a cent or two; this stops the display from reporting that drift. |
| Noisy | Loud for 0.7 s without one trustworthy frame: "Too noisy to read". |

States: `quiet`, `searching`, `noisy`, `pitch` (with `settled`), `decay`.

## From a reading to the screen

`js/tuner-model.js` decides what the reading means:

- **Target, in order of precedence:** a typed frequency (Advanced) › the chosen string (Manual) › the string being played (Auto, only when clear) › the nearest note.
- **Auto string detection** picks the string nearest in cents, but only if it is within 400 ¢ and beats the runner-up by at least 150 ¢. Between two strings it shows plain note names rather than guess. Once on a string it stays there until another is 60 ¢ closer, so tuning a string past the midpoint doesn't make it jump.
- **Note name hysteresis:** the shown note changes only once the pitch is 58 ¢ from it (50 is the midpoint), so the name doesn't flicker at the boundary.
- **In tune, with hysteresis.** It starts when |cents| ≤ the tolerance (±1, 2, 3, 5 or 10 ¢; default ±3, inclusive) *and* the pluck has settled. It holds while the pitch stays within the tolerance; it ends at once beyond tolerance + max(0.3 ¢, ¼ of the tolerance), or after 150 ms just outside. A new target starts out of tune. The cents shown are always the measured ones.
- **Directions:** "Tune up" / "Tune down" (with the size in semitones when large), "In tune", "Settling…" (within tolerance but the attack not yet over), "Pluck again" (the note has decayed; the last reading is kept, dimmed, with no direction).
- **Progress:** a string held in tune (settled) for 0.6 s is marked done. Changing the tuning, the reference pitch or the temperament clears the marks.
- **Signal quality:** three small bars next to the level meter show the confidence of the reading on screen (good, fair, weak).
- **Recent notes** keeps the last 12 notes held in tune, in memory only.

The page never relies on colour alone: the status line says what to do in words with an arrow or a check, the needle shows the direction, ♭ and ♯ light up at the ends of the scale, and a screen reader hears the note and direction when they change (at most every 1.5 s).

## What changed in 2.1

A user compared the tuner with GuitarTuna on a phone and found the low E string much harder to catch. The 2.0 detector was already MPM (not an FFT peak), so the audit looked at everything around it:

| Weakness in 2.0 | Effect | 2.1 |
| --- | --- | --- |
| Confidence = clarity alone, fixed thresholds (0.90 to start, 0.80 to keep) | Room noise lowers clarity in proportion to the SNR. A low E 8 dB above a noisy room read the right pitch in every frame at clarity 0.5–0.84 and was rejected: "Listening…" for the whole note | Noise-floor removal before the period search; confidence from clarity + level above the floor + harmonicity + frame-to-frame agreement |
| No harmonic analysis | Octave errors when a phone cuts the fundamental hard; sub-harmonic errors from rumble | Two harmonic checks on the cleaned spectrum (above) |
| Floor followed upward by any non-note frame | A slowly swelling bowed note raised the gate above itself | Tonal frames never raise the floor |
| Window halved once a note above 160 Hz was found | More jitter on the upper strings; the switch itself could change the octave decision mid-note | Window chosen once, by the instrument |
| A 1.4 s hold, then nothing | No guidance when a note faded; late readings drifted with the noise | `decay` → "Pluck again", with the last good reading |
| "In tune" was a bare threshold | Flicker at the edge of the tolerance; could show during the sharp attack | Hysteresis and settling |
| Voice-processing constraints never verified | A browser that kept noise suppression on would fade sustained notes silently | `getSettings()` read-back, `applyConstraints()` retry, reported and adapted to |

Measured on 162 real recordings through five simulated microphones (`tests/recordings.test.js`; the same harness was run on the 2.0 code for the "before" column):

| Microphone | Right note, 2.0 → 2.1 | Wrong note | Notes never found |
| --- | --- | --- | --- |
| Studio | 97.7 % → 99.7 % | 2.2 % → 0.2 % | 0 → 0 |
| Phone (150 Hz low cut, room −58 dBFS) | 98.5 % → 99.6 % | 1.3 % → 0.3 % | 0 → 0 |
| Harsh phone (250 Hz low cut) | 98.9 % → 99.8 % | 0.7 % → 0.1 % | 0 → 0 |
| Soft pluck (−30 dBFS) | 97.8 % → 99.5 % | 0.2 % → 0.1 % | 2 → 0 |
| Noisy room (~10 dB under the note) | 83.0 % → 95.0 % | 0.1 % → 0.2 % | 20 → 0 |

With an even harsher phone low cut (400 Hz, 24 dB/octave) on the guitar's six open strings and the bass's low E strings, 2.0 lost 1 of 16 notes, and 3 of 11 when the room was also noisy (including both bass low Es); 2.1 read all of them. The first reading still arrives about 150 ms after the pluck (200 ms in the noisy room); "In tune" can be confirmed from about 300–350 ms.

Honest limits of this evidence: the microphones are simulated (filters and added noise) and the recordings are single notes from sample libraries, not your guitar in your room; on these particular low-E recordings 2.0 had in fact coped except under the harshest conditions. The real check is [docs/TUNER-TESTING.md](TUNER-TESTING.md) on real phones.

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

**The microphone is released** (every track stopped, the browser's "in use" indicator off, the AudioContext closed) when Stop is pressed, when switching to the metronome, when the page is hidden or closed, after five minutes without a note, or if the device disappears. If listening stopped only because the page was hidden, it resumes when the page is shown again; after switching to the metronome it stays off until you press Start.

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
npm test                 # unit, scenario and engine tests in node (no dependencies), ~20 s
npm run test:recordings  # 165 real recordings × 5 microphones (fetches them first; needs npm and ffmpeg), ~2 min
npm run test:browser     # end-to-end in Chrome with a fake microphone (needs Playwright)
```

| Suite | Covers |
| --- | --- |
| `tests/notes.test.js` | Note ↔ frequency, cents, reference pitch, octave boundaries, round trips A0–C8 at any reference, parsing, invalid and non-finite input, formatting |
| `tests/pitch.test.js` | Detector, one frame at a time: sines B0–C8 (±0.1 ¢), string timbres, missing and weak fundamentals, dominant upper harmonics, Karplus–Strong plucks (±0.1 ¢), decay, noise at 10 dB SNR, pure noise, silence, drift, vibrato, 44.1/96 kHz, an octave-error sweep over every note B0–C8; the six guitar strings as realistic inharmonic plucks (±1 ¢) and through a phone microphone (no octave errors); the octave-down check (and why it exists); noise-floor removal; output fields; YIN; cost per frame |
| `tests/pitch-stabilizer.test.js` | Confidence scoring and agreement; steady readings, gating, weak-but-agreeing frames in a noisy room, pluck onsets and settling, attack frames, stray frames, note changes, a new string plucked, octave continuity, a young note caught an octave low, hints and range, following a turned peg, decay and "Pluck again", noisy state, the room's noise floor |
| `tests/tuning-scenarios.test.js` | The whole chain on E2 82.4069, A2 110, D3 146.832, G3 195.998, B3 246.942, E4 329.628 Hz, synthesised as real strings (inharmonic partials, pluck position, sharp attack, pick noise): clean plucks; weak fundamental under stronger harmonics through a phone microphone; soft, normal and hard plucks; attack vs sustain; decay into the room; background noise; noise, rumble and silence; octave traps; strings ±4, ±10, ±30 ¢ with direction and every tolerance (±1, 2, 5, 10); a peg being turned |
| `tests/recordings.test.js` | 162 real recordings (guitars, bass, cello, double bass, violin; 3 whose label disagrees with their pitch excluded) through studio, phone, harsh phone, soft pluck and noisy-room microphones; fails if any condition reads the right note in too few frames, a wrong note in more than 0.5 % of frames, misses notes, or is slow |
| `tests/tunings.test.js` | Required instruments and their notes, preset validity and range, validation messages, name sanitising, custom library CRUD and persistence, corrupt and hostile storage, settings store |
| `tests/tuner-model.test.js` | Targets, cents, tolerance boundaries, in-tune hysteresis, settling, faded readings, reference pitch, auto string detection (and refusal to guess), manual strings, typed frequency, note hysteresis, spelling, string progress, history |
| `tests/tuner-engine.test.js` | Permission granted / denied / no microphone / busy / unsupported / insecure, track and context release, stop during the permission prompt, hidden page, leaving for the metronome, unplugged device, idle stop, window by instrument, voice processing read back / retried / reported, iOS sample-rate correction, devices, reference tone |
| `tests/browser.test.js` | Real Chrome with a fake microphone playing generated recordings: E2 12 ¢ flat, a low E through a phone microphone, a note dying into "Pluck again", A2 in tune, a 31 Hz low B, A4 at 442 Hz with both reference pitches, a typed target, silence; microphone release; denied and missing microphone; each tool stopping when you leave it and staying stopped; instrument picker; custom tunings; Simple/Advanced; feedback, About and privacy; metronome regression; layouts from 320 px to 1440 px; no console errors, CSP violations, third-party requests or missing files |

The existing metronome suites (`rhythm`, `engine`, `terms`, `themes`, `privacy`) still run and pass.

The recordings come from the tonejs-instruments sample packs on npm (MIT licence); `tests/fetch-recordings.js` downloads them with `npm pack` (no install scripts run) and decodes them with ffmpeg into `tests/fixtures/recordings/`, which is not committed. To run the browser tests: `npm i -D playwright && npx playwright install chromium`, then `npm run test:browser`. Set `CHROME_PATH` to use an installed Chrome instead.

**Manual testing** on real instruments and phones: [docs/TUNER-TESTING.md](TUNER-TESTING.md).

## Browser compatibility

Tested: **Chrome 153 (desktop, Linux, and phone/tablet emulation)**, automated, including real microphone capture through Chrome's fake audio device, at phone, tablet and desktop sizes. Nothing else has been tested on real hardware yet.

Expected to work but **not yet tested**: Chrome and Edge on Windows and macOS, Chrome on Android, Firefox, Safari on macOS, Safari on iPhone and iPad (iOS 16.4 or later). The APIs used (getUserMedia, AudioContext, AnalyserNode with `getFloatTimeDomainData`, BiquadFilterNode) are supported in all of them; the code avoids AudioWorklet and newer features, and falls back where something is missing (byte samples if float samples aren't available; no wake lock where unsupported).

Known platform notes:

- **iOS Safari:** the microphone needs HTTPS and a tap. If iOS suspends the audio, the tuner shows a Continue button (one tap resumes). While the microphone is open, iOS routes sound in "play and record" mode, so the reference tone may be quieter or come from the earpiece; stop listening to hear the tone at full volume. The iOS ring/silent switch can mute the tone. The app sets the Audio Session type on Safari 17+ to reduce these effects.
- **All browsers:** the microphone is blocked on `http://` pages (except `localhost`) and on `file://`.
- **Laptop and phone microphones** roll off the lowest fundamentals (below ~100–250 Hz). The detector reads pitch from the harmonics' periodicity and checks the octave from the odd partials, so low strings still work, but a clip-on or USB microphone gives steadier readings for double bass and 5-string bass.
- **Voice processing:** some Android phones apply noise suppression in hardware whatever a page asks. Advanced › Microphone then says so; pluck again if a long note fades early.

## Known limitations and trade-offs

- **One note at a time.** This is a chromatic tuner, not a polyphonic one: strumming several strings gives no reading (it says the sound is too noisy).
- **Inharmonicity through a phone microphone.** Real strings are slightly inharmonic: their upper partials are a little sharp. When a phone microphone removes the fundamental, the pitch is carried by those partials, so a low string can read up to ~3–4 ¢ sharp late in its ring (measured on synthetic strings with B = 1e-4, a typical low E). Every tuner listening through such a microphone sees this; a clip-on pickup avoids it.
- **Accuracy vs. response:** the 170 ms window gives a steady reading; the display follows a turned peg within ~4 ¢ but trails the sound by about half a window. The first reading takes ~150 ms after a pluck, "In tune" ~300 ms.
- **Noise:** in a room only ~10 dB quieter than the note, readings scatter by about a cent and the note is shown for a shorter part of its ring before "Pluck again".
- **Equal temperament only** for now (see conventions above).
- **Mains hum** is periodic, so with loud hum and no instrument playing the tuner can show it (50 Hz reads near G1, 60 Hz between B♭1 and B1). Low sensitivity raises the gate above it.
- **No offline mode yet:** the page needs the network to load, though nothing is fetched while tuning.
- **History is session-only** by design (no unnecessary data kept).

## Deferred to later releases

Considered and left out so far, to keep the core reliable: other temperaments (pure fifths first), a strobe-style display, offline support (a service worker), per-tuning reference pitch, sweetened guitar tunings (cents offsets per string), polyphonic tuning, and calibration against an external reference.
