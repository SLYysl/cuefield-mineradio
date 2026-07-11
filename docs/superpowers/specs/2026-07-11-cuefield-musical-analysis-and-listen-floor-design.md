# Cuefield Musical Analysis And Listen Floor Design

## Goal

Make automatic transitions musically informed without cutting a song before the listener has heard enough of its identity.

## Decisions

- A track's protected identity is not always a hook. A credible repeated hook is protected through its end; a strong opening may be the signature section, but hearing it does not waive the minimum listening floor.
- AutoMix applies a dynamic floor of roughly 42% of the track, bounded to 72-108 seconds. The existing structural `protectedUntil` can only extend that floor.
- Explicit/manual skips are outside this guard. The guard only changes prepared automatic transitions.
- Basic Pitch runs in a persistent Electron worker. Renderer audio is reduced to four short mono windows including the opening, then resampled to 22.05 kHz.
- Musical profiles are cached with beat maps. Missing or low-confidence profiles are neutral.
- High-confidence harmonic/melodic compatibility only adjusts candidate ranking conservatively. It never hard-rejects a transition in this phase.

## Data Flow

1. Renderer decodes audio and samples opening, early-middle, late-middle, and late windows.
2. Preload sends bounded `Float32Array` data to the main process.
3. A worker lazily loads Basic Pitch, extracts notes, and returns a compact `musicalProfile`.
4. Beat-map cache persists the profile.
5. Cuefield compares two profiles and adds compact diagnostics to the transition result.
6. AutoMix computes `triggerAt = max(plannedTrigger, protectedUntil, minimumListenUntil)`.

## Failure Behavior

- Worker timeout, model error, or missing desktop bridge leaves the existing beat-only path unchanged.
- The worker accepts one bounded job at a time and restarts after timeout/error.
- No raw audio or lyrics are written to feedback logs.
