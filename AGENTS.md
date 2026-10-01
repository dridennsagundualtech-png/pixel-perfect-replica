<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture rules

- Detection config (AI weights, rules) lives as data in `src/lib/detection/` — rules are configuration objects so the future rule engine evaluates them generically instead of reading UI state.
- All project reads/writes go through `src/lib/projects.ts` (currently localStorage) so it can be swapped for Lovable Cloud tables without touching components.
- Detection UI is split into reusable pieces under `src/components/detection/` and `src/components/clips/`; no page hard-codes mode-specific logic.
- Never display invented AI scores; the score is called "Engagement Potential" and rule mode shows "Rules matched" instead.
- Detection runs as transcript → `candidate-generator` → `rule-engine` → `scoring` → `detection-pipeline` in `src/lib/detection/`; Rule Mode settings (length.min/max, audio.*) are the only source of thresholds — no second settings system.
- A boolean rule is on only when `enabled && value !== false` (matches the RuleSettingsPanel checkbox).
- `sample-transcript.ts` and `debug.ts` are dev-only (`bun scripts/detection-debug.ts`); never import them from pages or store sample data on a project.
- Transcription goes through `src/lib/transcription/transcription-provider.ts` (provider registry + `validateTranscript`); local Whisper runs transformers.js in `whisper.worker.ts` so the UI stays responsive, and paid transcription APIs are not allowed.
- The uploaded video File lives only in memory (`session-files.ts`) because localStorage can't hold it; the user re-selects it after a reload.
- Rules are `kind: "hard-filter" | "quality-signal"` (inferred via `getRuleKind` in rule-engine when missing); only hard filters reject, quality signals only feed the normalized Rule Score — so conversational clips aren't wiped out. Validate with `bun scripts/rule-mode-check.ts`.
- Clip export runs ffmpeg.wasm (single-thread core from unpkg, loaded lazily) in `src/lib/video/local-video-renderer.ts`; the source File is WORKERFS-mounted (never copied/uploaded/modified) and re-encoded to H.264/AAC MP4 for frame-accurate cuts. Pure range checks live in `clip-range.ts` (`bun scripts/video-render-check.ts`).
- Transcription uses `onnx-community/whisper-base_timestamped` (same base weights, exported with cross-attentions) and runs a second `return_timestamps: "word"` pass; `segment.words` is optional real Whisper timing, never estimated, and a failed word pass never fails the transcript.
- Dynamic Short captions live in `src/lib/video/dynamic-captions.ts` (pure, checked by `bun scripts/caption-check.ts`): only valid Whisper words are grouped and highlighted; segments without words fall back to static segment cues; settings persist via `caption-settings.ts` (localStorage).
- Cleanup cuts keep Smart Reframe: renderer rebases the clip-relative ReframeTrack through the EditPlan (`rebaseReframeTrack`) and crops once after concat, sharing the output clock with captions; check with `bun scripts/reframe-cleanup-check.ts`.
