# Changelog

## 2.1.0

The app is now called **Metronome & Tuner** (same logo), and the tuner's audio processing has been rebuilt for phones, low strings and noisy rooms.

### Tuner
- **Low strings through phone microphones.** The detector removes the room's noise floor from the spectrum before looking for the period, and checks the harmonics: a low E whose fundamental the microphone has cut is no longer read an octave up, and low rumble no longer pulls a reading down.
- **Confidence instead of a single threshold.** Each reading is scored from how cleanly it repeats, how far it stands above the room, how harmonic it is and whether consecutive readings agree. A low E in a noisy room, which 2.0 often left at "Listening…", is now read.
- **Steadier and more honest display.** Each pluck is detected: its attack is skipped, the reading appears at once, and "In tune" waits until the attack has settled ("Settling…"). Smoothing follows real changes, such as a turned peg, within a few cents, and stays still on jitter.
- **"In tune" holds** while you stay within the tolerance, without flickering at the edge.
- **"Pluck again"** when a note has decayed into the room, keeping the last good reading dimmed, instead of a reading that wanders.
- **Signal quality** shown as three small bars next to the level meter.
- **Microphone settings checked.** Echo cancellation, noise suppression and automatic gain are still requested off; the app now reads back what the browser actually applied, tries again if needed, adapts, and says so under Advanced › Microphone.
- The analysis window is chosen by the instrument (about 170 ms when it goes below 160 Hz) instead of changing mid-note.
- Measured on 162 recordings of real instruments through five simulated microphones: wrong-note frames fell from 2.2 % to 0.2 % (studio) and from 1.3 % to 0.3 % (phone); in a noisy room, right-note frames rose from 83 % to 95 % and notes never found fell from 20 to 0. YIN was evaluated on the same recordings and measured worse; details in `docs/TUNER.md`.

### Both tools
- **Switching stops the tool you leave.** Going to the tuner stops the metronome completely (as its Stop button does), and going to the metronome turns the microphone off. Neither restarts by itself when you come back. The dot that showed the metronome still playing is gone, since it no longer can.
- Renamed to **Metronome & Tuner** in the title, About, the home-screen name, the privacy page and the docs.

### Tests and docs
- New suites: the stabiliser and confidence rules; the whole chain on the six guitar strings (E2 82.4069, A2 110, D3 146.832, G3 195.998, B3 246.942, E4 329.628 Hz) synthesised as real, slightly inharmonic strings, clean, through a phone microphone, soft and hard, attack and decay, in noise, with octave traps and ±4/10/30 ¢ offsets at every tolerance; 165 real recordings (`npm run test:recordings`); browser tests for a low E through a phone microphone, "Pluck again" and tool switching.
- `docs/TUNER-TESTING.md`: a repeatable manual test on real instruments, phones and desktops.

## 2.0.0

The app is now a tuner and a metronome, and it opens on the tuner.

### Added
- **Chromatic tuner.** Detects every note from B0 (31 Hz) to C8 with the McLeod Pitch Method, a time-domain method that isn't fooled by strong harmonics or weak low fundamentals. Shows the note and octave, measured and target frequency, the difference in Hz and cents, and "tune up / tune down / in tune" in words, arrows and colour.
- **Instruments:** guitar (11 tunings, including Drop D, half step down, D standard, open tunings, DADGAD and 7-string), bass (4, 5 and 6-string), violin, viola, cello, double bass, ukulele, mandolin and banjo. Auto mode follows the string you play; Manual mode tunes the one you pick. Strings brought in tune are marked.
- **Custom tunings** for any instrument with up to 12 strings, saved in the browser.
- **Advanced mode for the tuner:** reference pitch (A4 = 400–480 Hz), tune to a typed frequency, tolerance ±1–10 cents, measurement table, reference tone generator (sine or triangle), live signal view, sensitivity, sharp or flat spelling, microphone picker and a session list of tuned notes. Temperament is equal temperament, built so others can be added.
- **Tuner and Metronome switch:** in the header on wide screens, a bottom bar on phones. `#metronome` in the address opens the metronome directly, and the home-screen icon offers both as shortcuts. A dot on the Metronome tab shows when it is still playing.
- **Luthier palette** (walnut, brass and ice blue), now the default. Visitors still on the old default move to it once; the palette can be changed in Preferences as before.
- **Fraunces**, a self-hosted serif, for the app name, dialog titles, the tuning name and the motto.
- Keeps the screen awake while the tuner listens.
- A self-contained `404.html` and `.nojekyll` for GitHub Pages; a Content-Security-Policy that blocks connections to other sites.
- Tests: note maths, pitch detection on synthetic signals (including an octave-error sweep over every note), the tuner's model, presets and storage, microphone handling with fakes, and an end-to-end browser suite with a fake microphone. `docs/TUNER.md` documents the design.

### Changed
- The privacy statement describes the microphone: used only while listening, analysed on the device, never recorded or sent, released when you stop, switch, hide the page or after five idle minutes.
- The in-app privacy text now matches `privacy.html` again (GitHub Pages hosting).
- The header shows the logo without the name; the app name is in About.
- The first-visit "Enable audio" prompt appears when the metronome is first opened, not over the tuner.
- Metronome keyboard shortcuts work while the metronome is shown; the shortcuts dialog lists both tools.
- `vercel.json` allows the microphone for the site itself (`microphone=(self)`), which the tuner needs.
- `build.js` also inlines scripts with hyphens in their names.

## 1.4.0

### Added
- New logo: a metronome with a swinging pendulum in front of a coral sun. It appears next to the app name, in the About dialog and on the privacy page; its outline and background adapt to every palette in light and dark.
- `icons/logo.svg` (transparent, for light backgrounds) and `icons/favicon.svg` (on a cream tile, readable on light and dark browser tabs), plus PNG and `.ico` fallbacks for older browsers and new home-screen icons.

## 1.3.0

### Added
- Six colour palettes, each in light and dark: Studio, Nocturne, Pastorale, Rosewood, Ebony and Ivory, Lilac. Pick them in Preferences (the palette button in the top bar).
- Theme can follow the device's light/dark setting automatically ("Auto").
- Note names in American (quarter note, eighth, sixteenth), British (crotchet, quaver, semiquaver) or both. Every place that names a note follows the setting: subdivision buttons, time-signature and beat-unit hints, swing/dotted hints, voice rows, presets and the practice log. The first-run default comes from the browser language (en-GB, en-AU… → British; en-US, en-CA → American; anything else → both).

### Changed
- All colours now come from one table in `js/themes.js`; a test checks every palette for readable contrast (WCAG).
- The theme is applied before the page draws, so there's no flash of the wrong colours on load.
- The slider fill variable now has a CSS default, so editors no longer report "--fill cannot be resolved".

## 1.2.0

### Added
- Feedback button beside the help button: opens Instagram or X (@sayrolivares) to report bugs, suggest features or get in touch, plus a "Copy app details" button for bug reports.
- About dialog with the version number, opened by clicking the app name or "About" in the footer.
- Privacy dialog and a standalone privacy page (`/privacy`): not for profit, no trackers, ads, cookies or data collection.
- "Made for musicians, by a musician" in the footer and the About dialog.
- Home-screen icons and a web app manifest for phones and tablets.

### Changed
- The Outfit typeface is now served with the app instead of from Google Fonts, so the app makes no third-party requests.
- Responsive layout reworked for phones, iPads and tablets: two columns from tablet width, the ring and tempo number scale with the space available, landscape phones fit on one screen, larger touch targets, no zoom when tapping text fields on iPhone and iPad, and dialogs open as bottom sheets on phones.
- Keyboard shortcuts pause while a dialog is open.

## 1.1.0

### Fixed
- **Tempo jumping to 60 BPM (or another value).** The tempo trainer and progressive practice forced their own start tempo on Play, and they were invisible in Simple mode. Now the tempo you set is what plays: with the trainer on, the main tempo is its start tempo; with progressive practice on, the tempo controls edit the current stage. Active tools appear as pills under the clocks in every mode, each with × to switch it off.
- **Tempo changes lagging at slow tempos.** A change used to wait for the whole current beat. The new scheduler applies it within ~0.12 s.
- **Glitches when switching windows.** Browsers throttle main-thread timers in background windows, so beats were scheduled late and then fired in bursts; the visual queue also piled up and froze the page on return. The scheduler now runs on a Web Worker clock, skips (rather than bunches) anything already missed, and drops stale visual events.
- **Voice roles in the Sound tab appearing not to change.** The role switcher was a hidden mode with an almost invisible selected state, and the Subdivision and Polyrhythm voices are silent unless those features are on. Each role now has its own row, a status line saying whether it is currently heard, and a separate Listen gallery that only previews.
- **Sound dying until reload.** Scheduler errors could stop the clock; suspended/interrupted audio was never resumed; settings saved by older versions could carry invalid values. The clock now survives errors, audio is resumed automatically or with one tap, a watchdog rebuilds a stalled audio device, and saved settings are validated on load.
- **Polyrhythm sounding in silent bars.** Polyrhythm pulses checked the silent-bar state at the wrong moment, so one pulse leaked into each silent bar and went missing from the playing bar. Beats, subdivisions and polyrhythm now share one grid and one silent-bar decision.
- Repeated "target reached" messages; practice timer not stopping while the window was in the background; Space activating a focused button as well as play/pause; mobile top bar overflowing.

### Added
- Help hints: hover, focus or tap any control for a short explanation. Toggle with the ? button or H.
- Pause and resume now continue a progressive practice where it left off; Stop returns to the program's start tempo.
- Engine test suite (`tests/engine.test.js`) that runs the scheduler against a simulated audio clock.
