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

## First migrated form

`/tattoos/inquire/` now submits to `/api/submissions` with `type=tattoo_inquiry`.

The remaining forms can migrate to the same endpoint by setting their `type` field:

- `flash_claim`
- `special_project`
- `build_brief`
- `art_acquisition`
- `consultation`
