# Audio assets

The MP3 files in this directory are runtime-ready game clips: mono, 44.1 kHz,
96 kbps. They are intentionally kept behind stable semantic filenames so the
audio engine can change the sound palette without changing simulation events.

## Creepy audio pass (2026-08-13)

The following clips were derived from the user-supplied archive
`Horror SFX Free.zip` and edited for gameplay length, fades, mono playback and
level consistency:

- Doors: `door-locked`, `door-unlocked`, `doors-open`
- Combat: `enemy-hit-1..3`, `enemy-died-1..2`, `enemy-shot`, `spikes-hit`
- Hero and weapons: `launch-spell`, `player-damaged`, `player-died`, `pit-fall`,
  `projectile-wall-spell`
- Progression and bosses: `level-start`, `room-cleared`, `shop-opened`,
  `boss-phase-changed`, `boss-telegraph`, `boss-wave-spawn`
- Interface: `ui-click`, `ui-cancel`, `upgrade-applied`, `upgrade-purchased`

The follow-up movement and weapon pass also replaces `pickup-coin`,
`pickup-potion`, `launch-body`, both Hielo clips (`launch-arrow` and
`projectile-wall-arrow`), both Hechizo clips (`launch-spell` and
`projectile-wall-spell`). The former `hero-slide-loop` movement layer was
removed after playtesting because it added an unwanted third sound to Cera.

## Directed replacements (2026-08-14)

- `aim-pull`: `Swoosh_3.wav`
- `launch-body`: `woosh_5.wav`
- `shop-opened`: a one-second seamless section of `Clock.wav`, looped while
  the hero is physically inside a room tagged `tienda`
- Hielo: `drink_slurp.wav` for `launch-arrow`, `ice_in_water.wav` for
  `projectile-wall-arrow`
- Hechizo: `sword_slice.wav` for `launch-spell`, `harsh_thud.wav` for
  `projectile-wall-spell`

The supplied archive contains no license or attribution document. Confirm the
original download's distribution terms before shipping these derived clips in
a public release.
