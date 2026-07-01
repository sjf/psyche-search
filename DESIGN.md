<!--
  SPDX-FileCopyrightText: 2026 PsycheSeek Contributors
  SPDX-License-Identifier: GPL-3.0-or-later
-->

# Design — PsycheSeek

PsycheSeek uses a flat **"neon-wire" cyberpunk** aesthetic: ink-black surfaces, a
faint violet grid and layered glow, with two neon accents used sparingly against
the dark. The canary mascot survives as a small gold accent — the animated
equalizer beside the now-playing track is its "song."

## Palette

<p>
  <img alt="Ink #07070E"     src="https://img.shields.io/badge/ink-07070E-07070E?style=flat-square&labelColor=07070E">
  <img alt="Magenta #FF2E97" src="https://img.shields.io/badge/magenta-FF2E97-FF2E97?style=flat-square&labelColor=FF2E97">
  <img alt="Cyan #23E0E6"    src="https://img.shields.io/badge/cyan-23E0E6-23E0E6?style=flat-square&labelColor=23E0E6">
  <img alt="Violet #9B7BFF"  src="https://img.shields.io/badge/violet-9B7BFF-9B7BFF?style=flat-square&labelColor=9B7BFF">
  <img alt="Canary #FFD23F"  src="https://img.shields.io/badge/canary-FFD23F-FFD23F?style=flat-square&labelColor=FFD23F">
</p>

| Token   | Hex       | Role |
| ------- | --------- | ---- |
| Ink     | `#07070E` | Base background |
| Magenta | `#FF2E97` | Primary accent — active nav, primary actions, now-playing |
| Cyan    | `#23E0E6` | Secondary accent — focus, links, downloads |
| Violet  | `#9B7BFF` | Connective mid-tone — tree lines, gradients |
| Canary  | `#FFD23F` | The mascot's "song" — the now-playing equalizer |

Text tiers run from `#ECEBF6` (primary) through `#A5A3C8` and `#6F6D97`
(muted / dim) for a legible hierarchy on the dark base.

## Typography

| Family | Role |
| ------ | ---- |
| [Chakra Petch](https://fonts.google.com/specimen/Chakra+Petch) | Display — brand wordmark, headings |
| [Sora](https://fonts.google.com/specimen/Sora) | Body / UI |
| [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono) | Data — sizes, bitrates, paths, timestamps |

## Principles

- **Flat, not skeuomorphic.** Depth comes from layered translucent surfaces, a fine
  grid, and soft neon glow — never bevels or drop-shadowed cards.
- **Neon is a scalpel.** Magenta and cyan mark active / focus / now-playing states;
  most of the UI stays quiet ink and muted violet-grey.
- **Motion on the moments that matter.** A staggered page-load reveal, the
  folder-open animation in the file tree, and hover/focus glows — not motion
  everywhere.
- **Data reads like a terminal.** Monospace for every number and path; uppercase,
  letter-spaced mono for column headers and labels.

The design tokens live in [`daemon-ui/src/index.css`](daemon-ui/src/index.css).
