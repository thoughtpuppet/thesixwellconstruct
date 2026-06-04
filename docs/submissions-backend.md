# Submissions Backend

This site now has a first-pass studio submissions backend:

- Public create endpoint: `POST /api/submissions`
- Private admin list endpoint: `GET /api/admin/submissions`
- Private admin detail endpoint: `GET /api/admin/submissions/:id`
- Private admin update endpoint: `PATCH /api/admin/submissions/:id`
- Review console: `/studio/submissions/`

## Cloudflare bindings

Create the D1 database:

```sh
wrangler d1 create swc-submissions
```

Add the returned binding to `wrangler.jsonc`:

```jsonc
"d1_databases": [
  {
    "binding": "SUBMISSIONS_DB",
    "database_name": "swc-submissions",
    "database_id": "paste-the-cloudflare-database-id"
  }
]
```

Apply the schema:

```sh
wrangler d1 migrations apply swc-submissions
```

Set the admin token:

```sh
wrangler secret put SUBMISSIONS_ADMIN_TOKEN
```

Optional file storage uses R2. If the `SUBMISSION_FILES` binding exists, uploaded reference files are stored under `submissions/{submissionId}/...`. If it does not exist, the backend still records file metadata, but it cannot preserve the file contents.

```jsonc
"r2_buckets": [
  {
    "binding": "SUBMISSION_FILES",
    "bucket_name": "swc-submission-files"
  }
]
```

## Migrated forms

The website submission paths now submit to `/api/submissions` with a `type` field:

- `/tattoos/inquire/` uses `tattoo_inquiry`
- `/tattoos/flash/claim/` uses `flash_claim`
- `/tattoos/build/` uses `build_brief`
- `/tattoos/special-projects/apply/` uses `special_project`
- `/tattoos/build/in-person/` uses `consultation`
- `/art/acquisitioninquiry.html` uses `art_acquisition`

The review console utility form at `/studio/submissions/` is not a submission path. It only collects the admin token in the browser so the console can read protected admin endpoints.
