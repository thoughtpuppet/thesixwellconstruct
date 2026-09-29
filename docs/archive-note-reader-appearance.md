# Notes-style reading surface (local, September 29, 2026)

## September 29 authorized release preflight

The user authorized commit, push, deploy and application of required Archive data
updates. All 21 focused reader/comment/Notes tests passed. Remote read-back confirms
`0231_archive_retrospective_comments.sql` was applied September 28, the original
phrase and source revision 1 remain intact, historical dates are unchanged, and
all three approved comments are published without review flags. No additional
Archive data write is necessary. Unrelated pending KINMARKING, Puzzle and Calendar
migrations and dirty Calendar edits are excluded. Deploy from the committed
snapshot, not the working tree. Earlier local-only status statements below record
the appearance iterations before this release authorization.

The existing Worker logs remain enabled; distributed traces are not explicitly
enabled in the existing configuration. No unrelated observability/configuration
change is included in this Archive release.

Single-storey a follow-up: the Notes-only fallback now bundles the full official
Inter 4.1 variable WOFF2 from https://rsms.me/inter/font-files/InterVariable.woff2?v=4.1,
with its SIL OFL license, under the CSS alias `Archive Note Inter`. The font-face
descriptor enables `cv11`; the shared Google Fonts subset did not visibly change
when that feature was requested. The local browser now visibly shows the alternate
a. Apple system fonts remain first; iOS WebKit requests SF's `ss07` separately,
which still requires physical iPhone verification. Do not apply `ss07` to Inter:
it means square punctuation in that font. No character substitutions, source edits,
control changes or comment popup typography changes are part of this follow-up.
Verified locally in dark and light modes; 12 reader/Notes tests pass and
`git diff --check` passes. Proof: `output/playwright/notes-single-storey-a.png`.
This follow-up is not committed, pushed or deployed.

Archive control styling: Light/Dark, zoom, Fit and Close use square corners,
uppercase Inter labels and Archive bright #B87A32, retaining the existing grey
control backgrounds. The Notes page, inner reader and zoom viewport use amber
scrollbars. Other site pages and the circular blue retrospective markers are not
restyled. The enlarged toolbar was verified at 319px without clipped controls,
with 44px touch targets retained. Seven focused reader contracts pass.

The shared renderer now provides a light/dark reading surface, normal source
capitalization, system sans-serif text, borderless images without visible captions,
and a zoomable image dialog. The Archive shell remains unchanged. Captions, source
text, dates and original media remain stored unchanged; comments stay separate.

The verified Lost Marbles drawing (media-72ee85ed-4c78-4571-b742-5e0c3533cdd2)
uses a reversible CSS dark treatment because the original PNG has an opaque white
background. This approximates the Notes dark drawing appearance; it is not a
replacement original or an exact reconstruction of Apple Pencil ink colors.
Photographs and other assets are not inverted. Image-region comments are deferred.

Dark-blue follow-up: the supplied `my 2.png` reference contains a Display P3
profile. Its dominant blue converts from #437df7 to approximately sRGB #297fff.
The shared reader now installs a local SVG display filter that retains the
existing inversion/hue treatment, then tints only blue-dominant pixels toward
that reference. Neutral pixels and red-dominant ink are unchanged by this tint.
It applies to the verified drawing in both the reader and zoom dialog; light mode,
photographs, source files, and the #2054FF comment icon are unchanged. Six focused
reader tests pass, with dark/light filters and enlarged rendering checked in the
browser. Native Safari color rendering remains an on-device verification step.

The body typography pass uses native Apple system fonts first and the site's
existing Inter web font on other platforms, replacing the Segoe UI fallback.
Source text is regular 17px with approximately 26px baseline spacing and -0.02em
tracking, measured against the supplied iPhone reference. Mobile reader padding
is 16px inside the Archive shell's existing inset. Dark body ink is #d6d6d6,
approximating the softer white in the supplied JPEG; light body ink stays #1c1c1e.
Archive headings, toolbar
typography and retrospective popup styling are unchanged. Native iPhone rendering
still needs on-device comparison; a Windows preview cannot verify SF Pro glyphs.

Zoom supports buttons, keyboard +/−/0, arrow-key panning, double-click, modifier-wheel,
pointer drag and two-pointer pinch. Browser-verified: zoom/Fit, keyboard pan,
comment opening at 150%, Escape focus return, 44px comment targets, 390px popup
containment, and theme persistence on reload. Physical iPhone pinch remains to be
verified on-device.

## Read-only preview

Run `node tools/archive-note-reader-preview.mjs` and open
`http://127.0.0.1:4192/archive/notes/lost-marbles-inception-note/`.
This serves local frontend files and GET/HEAD-only public production data.

During validation the production note response omitted `retrospective_comments`.
A read-only D1 check confirmed all three Lost Marbles comments still published,
with no review-required flags. The optional
`--comments-snapshot=.wrangler/note-reader-public-comments.json` flag uses the
verified public DTO snapshot locally, only for the exact note and matching source
and media targets. The snapshot is ignored, never deployed, and is not a production
API fix. Recheck live deployment/API coherence before any release.

Initial validation: 17 tests passed across archive-note-reader-contract,
archive-comments-contract and archive-notes-contract. No commit, push, production
data modification or deployment was performed for this appearance pass.
Typography follow-up: 9 tests passed across archive-note-reader-contract and
archive-notes-contract; computed 17px/26px/400/-0.34px body metrics and both theme
colors were checked at a 393px viewport. Comment title and CLOSE styling retained
their approved computed values. Temporary browser viewport override was reset.
