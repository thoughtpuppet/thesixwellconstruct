# Retrospective comments

Retrospective writing is independent of source Markdown, historical dates and Journal entries. The public reader uses one blue information marker per target and a shared, keyboard-accessible popup. Text targets keep field identity, exact quote, position, context and SHA-256 source fingerprint. Managed image/audio/video targets use asset identity and media evidence; timed targets validate against stored duration, or the duration observed by the authenticated Studio media preview when metadata is missing. That observation stays in the private anchor/audit, not the public comment payload. A changed source hides a marker until Studio explicitly reattaches it.

Studio's Notes and Archive-item editors include **Retrospective comments**. Select a saved text passage in its preview or choose a managed asset. For audio/video, leave times blank for a whole-file comment, or capture/enter a start and optional end. Save published comments only when both owner and target are public. Refresh saved targets after modifying source/attachments. Imported metadata is deliberately draft and stale; reattach and review before publishing. Exports include `retrospective-comments.json` separately, including draft/archived comments; original import metadata remains in the private revision history.

Published and previously published Notes lock source wording and historical dates in the regular form. **Correct source** requires a reason and optimistic version/fingerprint checks. Historical-date changes also require evidence. Correction history is Studio-only. Retrospective comment saves never update the Note row.

## Local verification

Run `node --test tests/archive-comments-contract.test.mjs tests/archive-notes-contract.test.mjs`. The isolated preview server `node tools/archive-comments-preview.mjs` uses only an in-memory database, local fixtures and the real API/component modules. It never proxies requests to production. Stop/restart it to reset its data.

## Authorized release steps (not performed by implementation)

1. Review and authorize commit/push separately.
2. Apply migration `0231_archive_retrospective_comments.sql` before deploying the API that queries its tables. It creates append-only audit stores and a database source-edit guard.
3. Deploy the API and public/Studio assets together; invalidate cached public detail responses as needed.
4. Set `SWC_RETROSPECTIVE_ADMIN_TOKEN` in the release shell without printing it. Run `node tools/archive-lost-marbles-retrospective.mjs --origin=https://thesixwellconstruct.com` for a read-only preflight.
5. Only with explicit production-content authorization, rerun with `--apply`. The tool accepts exactly the reviewed intervening phrase or the already-restored original, uses the correction API, preserves historical dates, and does not duplicate the approved comment. Unexpected source wording stops the tool. Existing stale/archived approved comments require manual review, not silent overwrite.
6. Verify the public Note and its nested Archive viewer, and check the Studio correction record and comment revision.

The September 28 release authorization adds `--move-image-captions` to the guarded Lost Marbles helper. It preserves the two approved image explanations as published media comments, then replaces their visible paragraphs with the short labels “Original handwritten sketch” and “Process experiment.” Caption changes are recorded in Studio revision history, and unexpected source/caption text stops the helper. Repeated runs do not duplicate comments. No Goat Farm visibility change, ruled-paper treatment or Gallery-wide integration is part of this release. Public payloads exclude source correction history and comment revision snapshots. Each reused media comment retains its original owner's publication gate; derivative asset IDs are not automatically annotated.

## Verification evidence

- Focused API/source/Journal/source-material suite: 17 passing tests. This covers comment creation/revision/archival, authentication, private assets, stale targets, duplicate passages, ranges, compare-and-swap conflicts, source dates, metadata round-trips and the guarded Lost Marbles release helper.
- Broader Archive/catalogue/identity regression run: 47/48 passed. The remaining `archive-studio-open-contract` assertion expects an August script cache version, while unchanged HEAD already uses the September version. It is not a regression from this implementation.
- Browser checks used the real Notes editor and public components against a local in-memory API: text/image/audio/video creation, reload, grouped comments, nested Note/material/image viewers, source correction and reattachment, keyboard selection/dismissal, focus return, 44px targets, 390px popup containment and seek without autoplay. Computed styles confirm the exact blue, title/close tan, Inter 700, ghost attribution and no close-button ring/fill/underline.
- `--seed-comments` starts the isolated preview with sample comments. The in-memory fixture is not production content. API correction/audit batches follow the Workers skill's bound-database transaction guidance.

## Production release — September 28, 2026

- Authorized in chat: deploy the system and update the real Lost Marbles inception Note, including the two image explanations.
- Release bundle: `.wrangler/releases/archive-retrospective-20260928`, built from `7a1f5193876217e5422dd448a9b2e19ba0b1ace6` with only the retrospective release files overlaid. Unrelated dirty Calendar files were excluded. No commit or push was performed.
- Backup: `.cloudflare-backups/before-archive-retrospective-records-20260928.sql` contains the affected existing tables. A whole-database SQL export was unavailable because of FTS5 virtual tables. Pre-migration D1 recovery bookmark: `00006ff8-00000000-000050f4-d238b08a7ddcde8e684ba7fa7753df00`.
- Production migration `0231_archive_retrospective_comments.sql` applied successfully; no migrations remain pending.
- Worker version: `51e65d32-a634-41b1-92e7-0a826c40ce29`. Deployment dry run passed before upload.
- Guarded helper with `--move-image-captions --apply` recorded one source correction, created the book-reference clarification and two image comments, and replaced the two long captions with short image labels. Historical dates remain `2022-12-23T19:54:00-05:00` and `2023-11-26`.
- Focused suite: 18/18 passing. Live verification confirmed three published, non-stale comments, all three popups, persistence after reload, nested Archive Note rendering, keyboard dismissal/focus return, 44px touch targets, 390px viewport containment, and the approved title/CLOSE styling. The existing public Notes list remains available; no Note was removed or unpublished.
- Screenshot: `output/playwright/lost-marbles-retrospective-live.png`.
