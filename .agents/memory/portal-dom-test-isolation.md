---
name: Portal DOM test isolation
description: Why authenticated full-portal DOM checks run each role and route in a separate process.
---

Run authenticated full-portal DOM checks with one role and one initial route per process rather than repeatedly mounting the app in a shared test worker.

**Why:** The portal eagerly imports and renders chart-heavy pages. Repeated full-app JSDOM mounts retained enough memory to terminate Node and Vitest workers, even with cleanup, while isolated mounts completed reliably.

**How to apply:** When extending the portal access matrix, add cases to the existing isolated-process loop. Keep lightweight access-helper assertions in the normal unit-test runner.

Use a finite Node test timeout for focused report DOM checks, and put unmount/DOM cleanup in `finally`.

**Why:** A failed assertion before cleanup can leave refresh intervals alive. The worker then appears hung and delays its detailed failure report; a shell timeout alone may hide the useful assertion output.

**How to apply:** Pass `--test-timeout=10000` (or a justified larger limit) when diagnosing a stalled focused suite, rather than repeatedly waiting for an unbounded worker.

Assert boolean DOM relationships rather than comparing whole DOM nodes with Node strict assertions.

**Why:** A failed node equality assertion can recursively format a large JSDOM/React tree and exhaust memory, disguising a simple assertion failure as a hung worker.

**How to apply:** Use `assert.equal(node.parentElement === expectedParent, true)` or `assert.ok(...)`. For portals, distinguish the outer overlay from the nested dialog, and query the document rather than only the render container.