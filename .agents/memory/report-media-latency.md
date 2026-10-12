---
name: Report media latency
description: Distinguish report API duration from browser contention caused by appendix media.
---
Investigate attachment traffic as well as database timing when report loading feels slow.

**Why:** Production logs during a reported long wait showed mostly subsecond report responses alongside multi-second bursts of evidence requests. The appendix loaded offscreen media and hidden print copies. This supports media contention as a contributor, not proof of the entire end-to-end delay.

**How to apply:** Keep offscreen evidence unloaded and video downloads user-initiated. CSS-hidden print media can still fetch; prepare image evidence explicitly for Print/PDF rather than mounting duplicate media during ordinary browsing. Preserve exact report freshness rather than masking latency with stale results.

University update history prints full notes and original attachment links, rather than a second image appendix.

**Why:** Checklist evidence needs explicit image preparation, while university-wide history may contain many older attachments unrelated to the filtered checklist. Link-only history print output avoids expanding that download workload.

**How to apply:** Keep history cards mounted during background refresh so loaded previews and video playback are not reset. Do not add hidden print image/video copies for history.