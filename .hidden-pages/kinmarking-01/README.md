# KINMARKING 01 working draft

Open http://localhost:4173/tools/kinmarking-01-draft/?edit=1 with the repository's local preview server running. The page and the edition copy were preserved from the full edition 01 page before its public route switched to the development fallback.

The local text editor applies page edits to `index.html` and edition-specific copy to `series.js` in this directory. These sources are independent of the public template and public series copy. The draft continues to read the existing event context for occurrence identity and schedule.

`.assetsignore` excludes `.hidden-pages/**` from deployment. The Worker also blocks this draft route and the private source directory on public hosts. Restoring the draft as the public page requires a separate, intentional change.
