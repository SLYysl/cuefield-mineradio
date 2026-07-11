# Cuefield Musical Understanding Research

> 2026-07-11 | Local research and spike; no production model dependency added yet.

## Problem

Cuefield currently understands rhythm, energy, coarse frequency bands, lyrics, and approximate song structure. It does not represent notes, melodic contour, chord movement, key compatibility, stems, or musical texture. A rhythmically valid transition can therefore be musically wrong.

## Recommended Stack

1. **Spotify Basic Pitch TypeScript** for cached note events and pitch bends. Apache-2.0, Electron-compatible, model package about 0.9 MB. It works best on one instrument, so full-mix output must be filtered and should later use a harmonic or vocal stem.
2. **Demucs** as an optional offline stem analyzer. MIT; separates drums, bass, vocals, and other, but is much heavier and its current maintainer warns that development is slow.
3. **All-In-One Music Structure Analyzer** for beats, downbeats, and functional labels. MIT and useful for offline validation, but its dependency/model chain is too heavy for the playback path.
4. **MuQ / MERT / CLAP** only as future offline semantic embeddings. MuQ and MERT weights are CC-BY-NC; MERT is about 1.7 GB. They are unsuitable as the default public-app dependency.

Avoid making Essentia.js the default dependency: it is capable and browser-native, but AGPL-3.0 and roughly 10 MB unpacked. Madmom source is BSD, while its model/data files are CC BY-NC-SA.

## Local Basic Pitch Spike

- Input: 15-second, mono, 22.05 kHz real song windows.
- Runtime: 10.2-10.9 seconds per window using pure TensorFlow.js CPU.
- RSS: 191-196 MB.
- Output: 243-348 raw note events per window.
- Package: `@spotify/basic-pitch@1.0.1`, Apache-2.0; package model is under 1 MB.

After duration/amplitude filtering, pitch-class cosine similarity was:

- Summertime Love tail -> Heat Waves hook: `0.821`
- Heat Waves hook -> Westlake hook: `0.670`
- Summertime Love tail -> Westlake hook: `0.930`

This already distinguishes the more harmonically stretched Heat Waves -> Westlake transition, but full-mix transcription is noisy and must not become a single hard gate.

## Integration Order

1. Cache Basic Pitch analysis only for shortlisted next-song candidates and only around candidate exit/entry windows.
2. Convert note events into compact `musicalProfile` data: pitch-class profile, estimated key/mode, transposition-invariant interval profile, density, and confidence.
3. Add musical compatibility to candidate ranking and recipe routing. Low confidence should remain neutral, never reject a transition.
4. Use high-confidence harmonic clash to choose deliberate cut/echo/filter recipes instead of overlapping melodies.
5. Add optional Demucs analysis later, using vocals/other stems to reduce drum-harmonic false notes.

## Primary Sources

- [Spotify Basic Pitch TypeScript](https://github.com/spotify/basic-pitch-ts)
- [Spotify Basic Pitch Python](https://github.com/spotify/basic-pitch)
- [All-In-One Music Structure Analyzer](https://github.com/mir-aidj/all-in-one)
- [Demucs maintained fork](https://github.com/adefossez/demucs)
- [MuQ](https://github.com/tencent-ailab/MuQ)
- [MERT model](https://huggingface.co/m-a-p/MERT-v1-95M)
- [Essentia.js](https://github.com/MTG/essentia.js)
- [Madmom](https://github.com/CPJKU/madmom)
