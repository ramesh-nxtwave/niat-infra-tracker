# Report refresh layout checks

Run the frontend managed workflow, then:

```sh
pnpm --filter @workspace/infra-tracker test:layout
```

The default target is the app's root proxy at `http://localhost:80`.
Set `REPORT_TEST_URL` to another running development preview origin if needed.
The checks load the real `/reports` route, intercept API responses and create a
synthetic browser-only session. They do not sign into, modify, or seed the database.

Replit's system Chromium is used when available. Else install Chromium with
`pnpm --filter @workspace/infra-tracker exec playwright install chromium`, or set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE` to a compatible browser binary.

## Measurements

The checks allow **2 CSS pixels** for bounding-box rounding, not an extra line,
changed control track, or displaced row. They compare document-space header,
actions, university filters, report toolbar, table, history heading and history
content, as well as scroll offsets and viewport-space reading anchors.

Widths cover desktop (1280px), mobile (390px), and one pixel above the measured
header wrapping threshold, calculated after fonts load. The fake browser clock
exercises the actual focus, hidden-to-visible and 30-second interval handlers;
primary and history requests can be held independently.

Original reproductions before the fixes:

- Refresh widened the action group by approximately 35px.
- Print-readiness text inserted 24px at desktop / 48px at mobile above filters.
- Loaded empty history disappeared into its initial loading state.
- Mounting appendix video previews exposed a print-only reference and displaced
  the following history by 48px on desktop.

The suite also checks failed history refresh/retry, primary failures and print
gating, portrait image/video metadata loading, preview failures, link-only history
print output, expanded chooser and table-scroll retention, inserted history,
longer remarks above the reader, deliberate scrolling while pending, removed
anchors and superseded university requests.

The small portrait video fixture is VP9 in MP4, avoiding headless Chromium's
H.264 decoding limitations. It was generated with:

```sh
ffmpeg -f lavfi -i color=c=blue:s=64x128:d=0.5 -c:v libvpx-vp9 -an \
  -movflags +faststart portrait.mp4
```
