function rangeResponse(total) {
  return new Response(null, {
    status: 416,
    headers: {
      "accept-ranges": "bytes",
      "content-range": `bytes */${total}`,
      "cache-control": "private, no-store",
    },
  });
}

function requestedRange(value, total) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(String(value).trim());
  if (!match || (!match[1] && !match[2]) || total <= 0) return false;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return false;
    const length = Math.min(suffix, total);
    return { offset: total - length, length };
  }
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : total - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start < 0 || start >= total || requestedEnd < start) return false;
  const end = Math.min(requestedEnd, total - 1);
  return { offset: start, length: end - start + 1 };
}

export async function serveR2Media(request, bucket, row, missingResponse) {
  if (row.source_url) {
    return new Response(null, {
      status: 302,
      headers: {
        location: new URL(row.source_url, request.url).href,
        "cache-control": "private, no-store",
      },
    });
  }
  if (!bucket || !row.storage_key) return missingResponse();
  const head = await bucket.head(row.storage_key);
  if (!head) return missingResponse();

  const total = Number(head.size ?? row.byte_size ?? 0);
  const range = requestedRange(request.headers.get("range"), total);
  if (range === false) return rangeResponse(total);

  const headers = new Headers();
  head.writeHttpMetadata?.(headers);
  const filename = String(row.original_filename || "media").replace(/[\r\n"]/g, "-");
  headers.set("content-type", row.mime_type || row.content_type || headers.get("content-type") || "application/octet-stream");
  headers.set("content-disposition", `inline; filename="${filename}"`);
  headers.set("cache-control", "private, no-store");
  headers.set("x-content-type-options", "nosniff");
  headers.set("accept-ranges", "bytes");
  headers.set("content-length", String(range ? range.length : total));
  if (head.httpEtag) headers.set("etag", head.httpEtag);
  if (range) headers.set("content-range", `bytes ${range.offset}-${range.offset + range.length - 1}/${total}`);
  if (request.method === "HEAD") return new Response(null, { status: range ? 206 : 200, headers });

  const object = await bucket.get(row.storage_key, range ? { range } : undefined);
  if (!object?.body) return missingResponse();
  return new Response(object.body, { status: range ? 206 : 200, headers });
}
