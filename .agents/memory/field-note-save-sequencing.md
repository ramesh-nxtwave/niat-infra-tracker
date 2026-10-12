---
name: Field-note save sequencing
description: Invariant for coordinating checklist remark autosaves with other remark-writing actions.
---

Serialize every checklist remark writer for the same item, including autosave, blur, full-checklist save, and bulk-apply source updates. Coalesce only identical writes that are currently pending or in flight; never suppress a future write because the same value succeeded earlier.

**Why:** Other actions can change the server value between two identical local drafts. A permanent completed-value cache can therefore report success while skipping the request needed to restore the user's current draft.

**How to apply:** Route any new single-item remark writer through the shared per-item queue. Cancel a live debounce before an action that already persists the complete current item, while allowing that complete save to follow any request already in flight.

Commit each successful item's client cache update and draft acknowledgement before releasing that item's queue slot; do not defer these until the whole checklist batch finishes.

**Why:** A blocked sibling item can keep a manual batch open while a newer autosave on an already-saved item completes. Applying the old batch snapshot afterward can restore older text in the client even though the database contains the newer note.

**How to apply:** Keep batch-level failure aggregation separate from per-item success reconciliation. Match acknowledgements to draft generations, and include a blocked-sibling/newer-autosave scenario when changing this sequencing.

Copy admission must distinguish a source draft actively being saved from a genuinely newer unsaved draft. Wait for active source writers, then recheck and use only acknowledged fields.

**Why:** Field-scoped dirty checks alone still rejected legitimate copy actions while source autosaves were in flight; this repeatedly surfaced as a false “newer source edits” warning.

**How to apply:** Preserve the guard for failed saves and newer drafts without an active writer. Exercise the full prompt/save/copy sequence, including prompt identity changes, rather than testing only individual guard functions.

Propagation prompts triggered by another field must wait for a newer remark debounce and queued write on the same item to finish before opening.

**Why:** A slow status save can finish while the user is typing a remark whose request is serialized behind it. Opening the status prompt at that point interrupts typing and presents propagation choices before the newer remark is committed.

**How to apply:** Before admitting a field prompt, wait until the item's remark timer and save queue are idle, then verify the remark draft was acknowledged. Preserve a deferred prompt across failed remark saves so a later successful retry can release it.

Remark autosave must remain silent while the textarea is active. Offer propagation only after blur and after the latest remark generation is acknowledged.

**Why:** Triggering a modal from the idle debounce interrupts users during normal typing pauses and makes an acknowledged autosave appear incomplete.

**How to apply:** Keep debounce writes independent from propagation UI. On blur, reuse an in-flight identical save when present; if the latest draft is already acknowledged, open the prompt without issuing a duplicate request.

Model-classroom propagation is a shared dialog fed by status, photo, and remark commits. Gate the parent dialog queue while any checklist remark field is focused, not only while a remark request is pending.

**Why:** An asynchronous photo or status commit can finish during typing; save-queue idleness alone does not mean the user has finished editing.

**How to apply:** Track remark focus at the model-form level. Admit queued copy dialogs only after blur and when no remark draft remains pending or failed.