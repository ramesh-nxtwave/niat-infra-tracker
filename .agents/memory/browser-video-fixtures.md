---
name: Browser video fixtures
description: Codec guidance for browser-level evidence upload checks in the Replit test environment.
---

Use a small VP9 Profile 0 video in an MP4 container for headless Chromium evidence-upload checks. A valid H.264 High/AAC MP4 can remain at `readyState` 0 in the test browser even when storage returns correct `video/mp4` bytes and HTTP range responses.

**Why:** The headless browser's available codecs can differ from desktop Chrome. A codec mismatch looks like a broken upload journey and can hide successful signing, persistence, and playback plumbing.

**How to apply:** For real browser upload regression fixtures, confirm the codec with `ffprobe`, prefer VP9/yuv420p without audio, and separately verify byte-range responses so codec and transport failures are not conflated.