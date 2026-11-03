# Changelog

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
