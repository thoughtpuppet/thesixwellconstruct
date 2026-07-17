// External CRM provider adapters.
//
// This module intentionally owns no D1 schema. A caller can either collect the
// bounded records returned by each sync or inject `database` plus an async
// `onBatch`/`persistPage` callback. The callback receives each normalized page
// together with the checkpoint that follows it, so records and checkpoint can
// be committed in one D1 transaction by the CRM service.

export const SQUARE_API_VERSION = "2026-05-20";
export const SHOPIFY_ADMIN_API_VERSION = "2026-07";

export const CRM_PROVIDER_ENV = Object.freeze({
  square: Object.freeze({
    requiredSecrets: ["SQUARE_ACCESS_TOKEN"],
    requiredVariables: [
      "SQUARE_LOCATION_ID",
      "SQUARE_STUDIO_LOCATION_ID",
      "SQUARE_EVENTS_LOCATION_ID",
    ],
    requiredScopes: ["PAYMENTS_READ", "CUSTOMERS_READ"],
    optionalWebhookSecrets: [
      "SQUARE_WEBHOOK_SIGNATURE_KEY",
      "SQUARE_STUDIO_WEBHOOK_SIGNATURE_KEY",
      "SQUARE_EVENTS_WEBHOOK_SIGNATURE_KEY",
    ],
  }),
  shopify: Object.freeze({
    requiredSecrets: ["SHOPIFY_ADMIN_ACCESS_TOKEN"],
    requiredVariables: ["SHOPIFY_STORE_DOMAIN"],
    optionalVariables: ["SHOPIFY_ADMIN_API_VERSION"],
    optionalWebhookSecrets: ["SHOPIFY_WEBHOOK_SECRET"],
    requiredScopes: ["read_orders", "read_all_orders", "read_customers"],
  }),
  beehiiv: Object.freeze({
    requiredSecrets: ["BEEHIIV_API_KEY"],
    requiredVariables: ["BEEHIIV_PUBLICATION_IDS"],
    requiredScopes: ["subscriptions:read"],
  }),
  substack: Object.freeze({
    mode: "csv",
    requiredSecrets: [],
    requiredVariables: [],
  }),
});

export const PROVIDER_SYNC_LIMITS = Object.freeze({
  maxPages: 12,
  defaultPages: 4,
  squarePageSize: 100,
  squareCustomerBatchSize: 100,
  shopifyOrderPageSize: 20,
  shopifyCustomerPageSize: 50,
  beehiivPageSize: 100,
  maxResponseBytes: 4 * 1024 * 1024,
  defaultTimeoutMs: 15_000,
  maxTimeoutMs: 30_000,
});

const SQUARE_EARLIEST_TIME = "2013-01-01T00:00:00.000Z";
const SYNC_OVERLAP_MINUTES = 5;

const SHOPIFY_ORDERS_QUERY = `
  query CrmOrders($first: Int!, $after: String, $query: String) {
    orders(
      first: $first
      after: $after
      query: $query
      sortKey: UPDATED_AT
    ) {
      nodes {
        id
        name
        email
        phone
        createdAt
        updatedAt
        processedAt
        cancelledAt
        displayFinancialStatus
        fullyPaid
        unpaid
        test
        sourceName
        tags
        currentTotalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        totalReceivedSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        totalRefundedSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        totalTipReceivedSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        customer {
          id
          displayName
          firstName
          lastName
          verifiedEmail
          defaultEmailAddress {
            emailAddress
            marketingState
            marketingUpdatedAt
          }
          defaultPhoneNumber {
            phoneNumber
            marketingState
          }
        }
        lineItems(first: 50) {
          nodes {
            id
            name
            quantity
            originalTotalSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            discountedTotalSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            variant {
              id
              product {
                id
                handle
                productType
                tags
              }
            }
          }
          pageInfo {
            hasNextPage
          }
        }
        transactions(first: 50) {
          id
          kind
          status
          gateway
          processedAt
          createdAt
          amountSet {
            shopMoney {
              amount
              currencyCode
            }
          }
        }
        refunds {
          id
          createdAt
          updatedAt
          processedAt
          totalRefundedSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          transactions(first: 25) {
            nodes {
              id
              kind
              status
              gateway
              processedAt
              createdAt
              amountSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
            }
            pageInfo {
              hasNextPage
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const SHOPIFY_CUSTOMERS_QUERY = `
  query CrmCustomers($first: Int!, $after: String, $query: String) {
    customers(
      first: $first
      after: $after
      query: $query
      sortKey: UPDATED_AT
    ) {
      nodes {
        id
        displayName
        firstName
        lastName
        createdAt
        updatedAt
        state
        verifiedEmail
        numberOfOrders
        tags
        amountSpent {
          amount
          currencyCode
        }
        defaultEmailAddress {
          emailAddress
          marketingState
          marketingUpdatedAt
        }
        defaultPhoneNumber {
          phoneNumber
          marketingState
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

class ProviderSyncError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "ProviderSyncError";
    this.code = code;
    this.status = Number(options.status) || null;
    this.retryable = Boolean(options.retryable);
    this.retryAfterSeconds =
      Number.isFinite(Number(options.retryAfterSeconds)) &&
      Number(options.retryAfterSeconds) >= 0
        ? Number(options.retryAfterSeconds)
        : null;
  }
}

function asString(value, max = 2000) {
  if (value === null || value === undefined) return "";
  const text = typeof value === "string" ? value.trim() : String(value).trim();
  return text.slice(0, max);
}

function normalizeEmail(value) {
  return asString(value, 320).toLowerCase();
}

function normalizePhone(value) {
  const raw = asString(value, 100);
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return "";
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}

function normalizeMarketingStatus(value) {
  const status = asString(value, 80).toLowerCase();
  if (["active", "subscribed"].includes(status)) return "subscribed";
  if (["inactive", "unsubscribed", "invalid", "redacted"].includes(status)) {
    return "unsubscribed";
  }
  if (status === "paused") return "paused";
  return "unknown";
}

function clampInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(number)));
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => asString(value)).filter(Boolean))];
}

function safeArray(value, max = 100) {
  return Array.isArray(value) ? value.slice(0, max) : [];
}

function safeIso(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function nowIso(options) {
  const supplied = options?.now;
  const date =
    supplied instanceof Date
      ? supplied
      : supplied
        ? new Date(supplied)
        : new Date();
  if (Number.isNaN(date.getTime())) {
    throw new ProviderSyncError("invalid_now", "The supplied sync time is invalid.");
  }
  return date.toISOString();
}

function subtractMinutes(value, minutes) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCMinutes(date.getUTCMinutes() - minutes);
  return date.toISOString();
}

function oneYearBefore(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCFullYear(date.getUTCFullYear() - 1);
  return date.toISOString();
}

function parseCheckpoint(value, provider) {
  if (!value) return null;
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new ProviderSyncError(
        "invalid_checkpoint",
        `The saved ${provider} checkpoint is not valid JSON.`
      );
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ProviderSyncError(
      "invalid_checkpoint",
      `The saved ${provider} checkpoint is invalid.`
    );
  }
  if (parsed.provider && parsed.provider !== provider) {
    throw new ProviderSyncError(
      "invalid_checkpoint",
      `The saved checkpoint belongs to a different provider.`
    );
  }
  return parsed;
}

function normalizeMode(value, fallback = "incremental") {
  const mode = asString(value).toLowerCase();
  return mode === "full" || mode === "incremental" ? mode : fallback;
}

function syncWindow(provider, options, checkpoint, fullStart) {
  if (checkpoint && !checkpoint.complete) {
    const windowStart = safeIso(checkpoint.windowStart);
    const windowEnd = safeIso(checkpoint.windowEnd);
    if (!windowStart || !windowEnd) {
      throw new ProviderSyncError(
        "invalid_checkpoint",
        `The saved ${provider} checkpoint has an invalid sync window.`
      );
    }
    return {
      mode: normalizeMode(checkpoint.mode, "full"),
      windowStart,
      windowEnd,
    };
  }

  const mode = normalizeMode(options.mode, checkpoint?.complete ? "incremental" : "full");
  const windowEnd = nowIso(options);
  let windowStart = safeIso(options.since);
  if (options.since && !windowStart) {
    throw new ProviderSyncError("invalid_since", "The supplied sync start time is invalid.");
  }
  if (!windowStart) {
    if (mode === "full") {
      windowStart = fullStart;
    } else {
      windowStart =
        subtractMinutes(checkpoint?.updatedAfter, SYNC_OVERLAP_MINUTES) ||
        oneYearBefore(windowEnd);
    }
  }
  if (new Date(windowStart).getTime() > new Date(windowEnd).getTime()) {
    throw new ProviderSyncError(
      "invalid_sync_window",
      "The sync start time must be before the end time."
    );
  }
  return { mode, windowStart, windowEnd };
}

function retryAfterSeconds(response) {
  const header = asString(response.headers.get("retry-after"), 100);
  if (!header) return null;
  const numeric = Number(header);
  if (Number.isFinite(numeric) && numeric >= 0) return numeric;
  const date = new Date(header);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.ceil((date.getTime() - Date.now()) / 1000));
}

async function readTextBounded(response, maxBytes) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new ProviderSyncError(
      "upstream_response_too_large",
      "The provider response exceeded the configured size limit.",
      { status: response.status, retryable: false }
    );
  }

  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // The size error below is the actionable result.
        }
        throw new ProviderSyncError(
          "upstream_response_too_large",
          "The provider response exceeded the configured size limit.",
          { status: response.status, retryable: false }
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

async function fetchJson(url, init, options = {}) {
  const fetchImpl = typeof options.fetch === "function" ? options.fetch : fetch;
  const timeoutMs = clampInteger(
    options.timeoutMs,
    PROVIDER_SYNC_LIMITS.defaultTimeoutMs,
    2_000,
    PROVIDER_SYNC_LIMITS.maxTimeoutMs
  );
  const maxBytes = clampInteger(
    options.maxResponseBytes,
    PROVIDER_SYNC_LIMITS.maxResponseBytes,
    64 * 1024,
    PROVIDER_SYNC_LIMITS.maxResponseBytes
  );
  const controller = new AbortController();
  const externalSignal = options.signal;
  const abortFromExternal = () => controller.abort(externalSignal?.reason);
  if (externalSignal) {
    if (externalSignal.aborted) abortFromExternal();
    else externalSignal.addEventListener("abort", abortFromExternal, { once: true });
  }
  const timeout = setTimeout(
    () => controller.abort(new DOMException("Provider request timed out.", "TimeoutError")),
    timeoutMs
  );

  let response;
  try {
    response = await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    const timedOut =
      controller.signal.reason?.name === "TimeoutError" ||
      error?.name === "TimeoutError";
    throw new ProviderSyncError(
      timedOut ? "upstream_timeout" : "upstream_network_error",
      timedOut
        ? "The provider request timed out."
        : "The provider could not be reached.",
      { retryable: true }
    );
  } finally {
    clearTimeout(timeout);
    if (externalSignal) {
      externalSignal.removeEventListener("abort", abortFromExternal);
    }
  }

  const text = await readTextBounded(response, maxBytes);
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new ProviderSyncError(
        "upstream_invalid_json",
        "The provider returned an invalid JSON response.",
        { status: response.status, retryable: response.status >= 500 }
      );
    }
  }
  return { response, payload };
}

function httpError(provider, response, payload) {
  const status = Number(response.status) || 502;
  const providerMessage =
    safeArray(payload?.errors, 3)
      .map((entry) => asString(entry?.detail || entry?.message, 300))
      .filter(Boolean)
      .join("; ") ||
    asString(payload?.message || payload?.error, 500);
  return new ProviderSyncError(
    `${provider}_http_error`,
    providerMessage || `${provider} returned HTTP ${status}.`,
    {
      status,
      retryable: status === 408 || status === 429 || status >= 500,
      retryAfterSeconds: retryAfterSeconds(response),
    }
  );
}

function normalizedError(error) {
  if (error instanceof ProviderSyncError) {
    return {
      code: error.code,
      message: asString(error.message, 1000) || "Provider sync failed.",
      status: error.status,
      retryable: Boolean(error.retryable),
      retryAfterSeconds: error.retryAfterSeconds,
    };
  }
  return {
    code: "provider_sync_failed",
    message: "Provider sync failed unexpectedly.",
    status: null,
    retryable: false,
    retryAfterSeconds: null,
  };
}

function createStats() {
  return {
    pages: 0,
    received: 0,
    accepted: 0,
    skipped: 0,
    persistedPages: 0,
    hasMore: false,
  };
}

function failedResult(
  provider,
  error,
  checkpoint = null,
  stats = createStats(),
  warnings = [],
  records = emptyRecords(provider)
) {
  return {
    ok: false,
    provider,
    records,
    checkpoint,
    stats,
    warnings,
    error: normalizedError(error),
  };
}

function emptyRecords(provider) {
  if (provider === "square") return { payments: [], refunds: [] };
  if (provider === "shopify") return { orders: [], customers: [] };
  if (provider === "beehiiv") return { subscriptions: [] };
  return {};
}

async function emitBatch(options, provider, records, checkpoint, context) {
  const callback =
    typeof options.onBatch === "function"
      ? options.onBatch
      : typeof options.persistPage === "function"
        ? options.persistPage
        : null;
  if (!callback) return false;
  try {
    await callback({
      database: options.database || null,
      provider,
      records,
      checkpoint,
      context,
    });
    return true;
  } catch {
    throw new ProviderSyncError(
      "provider_persistence_failed",
      "The provider page could not be persisted.",
      { retryable: true }
    );
  }
}

function appendRecords(target, page) {
  for (const [key, values] of Object.entries(page)) {
    if (!Array.isArray(target[key])) target[key] = [];
    target[key].push(...safeArray(values, 10_000));
  }
}

function moneyObject(value) {
  const money = value?.shopMoney || value || null;
  if (!money) return null;
  const amount = asString(money.amount, 80);
  const currency = asString(money.currencyCode || money.currency, 12).toUpperCase();
  if (!amount || !currency) return null;
  return {
    amount,
    amountMinor: decimalToMinor(amount, currency),
    currency,
  };
}

function currencyMinorDigits(currency) {
  if (
    new Set([
      "BIF",
      "CLP",
      "DJF",
      "GNF",
      "ISK",
      "JPY",
      "KMF",
      "KRW",
      "PYG",
      "RWF",
      "UGX",
      "UYI",
      "VND",
      "VUV",
      "XAF",
      "XOF",
      "XPF",
    ]).has(currency)
  ) {
    return 0;
  }
  if (new Set(["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"]).has(currency)) {
    return 3;
  }
  return 2;
}

function decimalToMinor(value, currency) {
  const text = asString(value, 100);
  const match = text.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) return null;
  const digits = currencyMinorDigits(currency);
  const fraction = `${match[3] || ""}${"0".repeat(digits)}`.slice(0, digits);
  try {
    const whole = BigInt(match[2]);
    const scale = 10n ** BigInt(digits);
    const minor = whole * scale + BigInt(fraction || "0");
    const signed = match[1] ? -minor : minor;
    const numeric = Number(signed);
    return Number.isSafeInteger(numeric) ? numeric : signed.toString();
  } catch {
    return null;
  }
}

function squareMoney(value) {
  if (!value || value.amount === null || value.amount === undefined) return null;
  const amount = Number(value.amount);
  if (!Number.isSafeInteger(amount)) return null;
  return {
    amountMinor: amount,
    currency: asString(value.currency, 12).toUpperCase() || "USD",
  };
}

function squareBaseUrl(env) {
  return env.SQUARE_ENVIRONMENT === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";
}

function squareLocations(env) {
  const candidates = [
    {
      key: "tattoo",
      id: asString(env.SQUARE_LOCATION_ID),
      nodeId: "node-tattoos",
    },
    {
      key: "studio",
      id: asString(env.SQUARE_STUDIO_LOCATION_ID),
      // This location can contain studio bookings, art, tattoo, or other POS
      // sales. Leave it unclassified unless an existing order link resolves it.
      nodeId: null,
    },
    {
      key: "events",
      id: asString(env.SQUARE_EVENTS_LOCATION_ID),
      nodeId: "node-events",
    },
  ];
  const seen = new Set();
  return candidates.filter((entry) => {
    if (!entry.id || seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}

function squareTasks(locations) {
  return locations.flatMap((location) => [
    { locationKey: location.key, resource: "payments" },
    { locationKey: location.key, resource: "refunds" },
  ]);
}

function squareCheckpoint(env, options, parsedCheckpoint) {
  const locations = squareLocations(env);
  if (!asString(env.SQUARE_ACCESS_TOKEN) || locations.length === 0) {
    throw new ProviderSyncError(
      "square_not_configured",
      "Square sync requires SQUARE_ACCESS_TOKEN and at least one configured location."
    );
  }
  const tasks = squareTasks(locations);
  const window = syncWindow(
    "square",
    options,
    parsedCheckpoint,
    SQUARE_EARLIEST_TIME
  );

  if (parsedCheckpoint && !parsedCheckpoint.complete) {
    const taskIndex = clampInteger(parsedCheckpoint.taskIndex, -1, 0, tasks.length);
    if (taskIndex < 0) {
      throw new ProviderSyncError(
        "invalid_checkpoint",
        "The saved Square task index is invalid."
      );
    }
    return {
      version: 1,
      provider: "square",
      complete: false,
      mode: window.mode,
      windowStart: window.windowStart,
      windowEnd: window.windowEnd,
      taskIndex,
      cursor: asString(parsedCheckpoint.cursor, 10_000) || null,
    };
  }

  return {
    version: 1,
    provider: "square",
    complete: false,
    mode: window.mode,
    windowStart: window.windowStart,
    windowEnd: window.windowEnd,
    taskIndex: 0,
    cursor: null,
  };
}

function nextTaskCheckpoint(state, taskCount, cursor) {
  const next = { ...state };
  if (cursor) {
    next.cursor = asString(cursor, 10_000);
  } else {
    next.taskIndex += 1;
    next.cursor = null;
  }
  if (next.taskIndex >= taskCount) {
    next.complete = true;
    next.updatedAfter = next.windowEnd;
    next.cursor = null;
  }
  return next;
}

function squareAddressName(address) {
  const givenName = asString(address?.first_name, 200);
  const familyName = asString(address?.last_name, 200);
  return asString(`${givenName} ${familyName}`, 400) || null;
}

function squarePaymentName(payment) {
  const billingName = squareAddressName(payment?.billing_address);
  if (billingName) {
    return { displayName: billingName, source: "billing_address" };
  }
  const cardholderName = asString(
    payment?.card_details?.card?.cardholder_name,
    200
  );
  if (cardholderName) {
    return { displayName: cardholderName, source: "cardholder_name" };
  }
  return { displayName: null, source: null };
}

function normalizeSquarePayment(payment, location) {
  const payerName = squarePaymentName(payment);
  return {
    externalId: asString(payment.id, 300),
    provider: "square",
    sourceType: "payment",
    status: asString(payment.status, 80).toLowerCase(),
    customerExternalId: asString(payment.customer_id, 300) || null,
    orderExternalId: asString(payment.order_id, 300) || null,
    locationId: asString(payment.location_id, 300) || location.id,
    locationKey: location.key,
    nodeId: location.nodeId,
    email: normalizeEmail(payment.buyer_email_address) || null,
    payerDisplayName: payerName.displayName,
    payerDisplayNameSource: payerName.source,
    amount: squareMoney(payment.total_money || payment.amount_money),
    tip: squareMoney(payment.tip_money),
    refunded: squareMoney(payment.refunded_money),
    sourceTypeLabel: asString(payment.source_type, 80) || null,
    referenceId: asString(payment.reference_id, 300) || null,
    receiptUrl: asString(payment.receipt_url, 1000) || null,
    occurredAt: safeIso(payment.created_at),
    updatedAt: safeIso(payment.updated_at),
  };
}

function normalizeSquareCustomer(customer, requestedId) {
  const requestedExternalId = asString(requestedId, 300);
  const canonicalExternalId = asString(customer?.id, 300);
  const externalId = requestedExternalId || canonicalExternalId;
  if (!externalId) return null;
  const givenName = asString(customer?.given_name, 200);
  const familyName = asString(customer?.family_name, 200);
  const nickname = asString(customer?.nickname, 200);
  const organization = asString(customer?.company_name, 200);
  const email = normalizeEmail(customer?.email_address) || null;
  const phone = normalizePhone(customer?.phone_number) || null;
  const directoryDisplayName =
    asString(`${givenName} ${familyName}`, 400) ||
    nickname ||
    organization ||
    null;
  const displayName =
    directoryDisplayName ||
    email ||
    phone ||
    null;
  return {
    externalId,
    canonicalExternalId: canonicalExternalId || externalId,
    displayName,
    directoryDisplayName,
    givenName: givenName || null,
    familyName: familyName || null,
    organization: organization || null,
    email,
    phone,
    createdAt: safeIso(customer?.created_at),
    updatedAt: safeIso(customer?.updated_at),
  };
}

function addProviderWarning(warnings, message) {
  if (!Array.isArray(warnings) || !message || warnings.includes(message)) return;
  warnings.push(message);
}

function squareCustomerPermissionDenied(response, payload) {
  if (response.status !== 403) return false;
  return safeArray(payload?.errors, 10).some((error) => {
    const code = asString(error?.code, 100).toUpperCase();
    const detail = asString(error?.detail || error?.message, 500).toLowerCase();
    return code === "FORBIDDEN" ||
      code === "INSUFFICIENT_SCOPES" ||
      code === "INSUFFICIENT_PERMISSIONS" ||
      detail.includes("scope") ||
      detail.includes("permission");
  });
}

function squareCustomerEntryRetryable(entry) {
  return safeArray(entry?.errors, 10).some((error) => {
    const category = asString(error?.category, 100).toUpperCase();
    const code = asString(error?.code, 100).toUpperCase();
    return category === "API_ERROR" ||
      category === "RATE_LIMIT_ERROR" ||
      [
        "GATEWAY_TIMEOUT",
        "INTERNAL_SERVER_ERROR",
        "RATE_LIMITED",
        "REQUEST_TIMEOUT",
        "SERVICE_UNAVAILABLE",
        "TEMPORARY_ERROR",
      ].includes(code);
  });
}

async function squareCustomerProfiles(
  env,
  options,
  payments,
  lookupState,
  warnings
) {
  const customerIds = uniqueStrings(
    safeArray(payments, PROVIDER_SYNC_LIMITS.squarePageSize)
      .map((payment) => payment.customerExternalId)
  ).slice(0, PROVIDER_SYNC_LIMITS.squareCustomerBatchSize);
  if (!customerIds.length || lookupState.disabled) {
    return { profiles: new Map(), requested: customerIds.length, received: 0 };
  }

  const url = new URL("/v2/customers/bulk-retrieve", squareBaseUrl(env));
  const { response, payload } = await fetchJson(
    url,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
        "content-type": "application/json",
        "square-version": SQUARE_API_VERSION,
      },
      body: JSON.stringify({ customer_ids: customerIds }),
    },
    options
  );
  if (!response.ok) {
    if (squareCustomerPermissionDenied(response, payload)) {
      lookupState.disabled = true;
      addProviderWarning(
        warnings,
        "Square customer profiles are unavailable. Grant CUSTOMERS_READ, then run a full Square sync to populate names, email, and phone."
      );
      return { profiles: new Map(), requested: customerIds.length, received: 0 };
    }
    throw httpError("square", response, payload);
  }

  const responses =
    payload?.responses &&
    typeof payload.responses === "object" &&
    !Array.isArray(payload.responses)
      ? payload.responses
      : null;
  if (!responses) {
    throw new ProviderSyncError(
      "square_customer_response_invalid",
      "Square returned an invalid customer profile response.",
      { retryable: true }
    );
  }

  const profiles = new Map();
  let empty = 0;
  let unavailable = 0;
  let canonicalized = 0;
  for (const customerId of customerIds) {
    const entry = responses[customerId];
    if (squareCustomerEntryRetryable(entry)) {
      throw new ProviderSyncError(
        "square_customer_profile_retryable_error",
        "Square temporarily could not return one or more customer profiles.",
        { retryable: true }
      );
    }
    const customer = entry?.customer;
    const returnedCustomerId = asString(customer?.id, 300);
    const profile =
      returnedCustomerId
        ? normalizeSquareCustomer(customer, customerId)
        : null;
    if (
      profile &&
      (profile.displayName || profile.organization || profile.email || profile.phone)
    ) {
      profiles.set(customerId, profile);
      if (profile.canonicalExternalId !== customerId) canonicalized += 1;
    } else if (profile) {
      empty += 1;
    } else {
      unavailable += 1;
    }
  }
  if (empty > 0) {
    addProviderWarning(
      warnings,
      `${empty} Square customer profile${empty === 1 ? " contained" : "s contained"} no public name, email, phone, or company; payment details were used when available.`
    );
  }
  if (unavailable > 0) {
    addProviderWarning(
      warnings,
      `${unavailable} Square customer profile${unavailable === 1 ? " could" : "s could"} not be retrieved; linked payments were still imported.`
    );
  }
  return {
    profiles,
    requested: customerIds.length,
    received: profiles.size,
    empty,
    unavailable,
    canonicalized,
  };
}

function normalizeSquareRefund(refund, location) {
  return {
    externalId: asString(refund.id, 300),
    provider: "square",
    sourceType: "refund",
    status: asString(refund.status, 80).toLowerCase(),
    paymentExternalId: asString(refund.payment_id, 300) || null,
    orderExternalId: asString(refund.order_id, 300) || null,
    locationId: asString(refund.location_id, 300) || location.id,
    locationKey: location.key,
    nodeId: location.nodeId,
    amount: squareMoney(refund.amount_money),
    reason: asString(refund.reason, 500) || null,
    occurredAt: safeIso(refund.created_at),
    updatedAt: safeIso(refund.updated_at),
  };
}

async function squarePage(
  env,
  options,
  state,
  task,
  location,
  customerLookupState,
  warnings
) {
  const url = new URL(
    task.resource === "payments" ? "/v2/payments" : "/v2/refunds",
    squareBaseUrl(env)
  );
  url.searchParams.set("limit", String(PROVIDER_SYNC_LIMITS.squarePageSize));
  url.searchParams.set("location_id", location.id);
  url.searchParams.set("begin_time", SQUARE_EARLIEST_TIME);
  url.searchParams.set("end_time", state.windowEnd);
  url.searchParams.set("updated_at_begin_time", state.windowStart);
  url.searchParams.set("updated_at_end_time", state.windowEnd);
  url.searchParams.set("sort_field", "UPDATED_AT");
  url.searchParams.set("sort_order", "ASC");
  if (task.resource === "refunds") url.searchParams.set("status", "COMPLETED");
  if (state.cursor) url.searchParams.set("cursor", state.cursor);

  const { response, payload } = await fetchJson(
    url,
    {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
        "square-version": SQUARE_API_VERSION,
      },
    },
    options
  );
  if (!response.ok) throw httpError("square", response, payload);

  const source = safeArray(payload?.[task.resource], PROVIDER_SYNC_LIMITS.squarePageSize);
  let accepted = source
    .filter((entry) => asString(entry?.status).toUpperCase() === "COMPLETED")
    .map((entry) =>
      task.resource === "payments"
        ? normalizeSquarePayment(entry, location)
        : normalizeSquareRefund(entry, location)
    )
    .filter((entry) => entry.externalId);
  let customerProfilesRequested = 0;
  let customerProfilesReceived = 0;
  let customerProfilesEmpty = 0;
  let customerProfilesUnavailable = 0;
  let customerProfilesCanonicalized = 0;
  const paymentNameHintsReceived =
    task.resource === "payments"
      ? accepted.filter((payment) => payment.payerDisplayName).length
      : 0;
  if (task.resource === "payments" && accepted.length) {
    const customerResult = await squareCustomerProfiles(
      env,
      options,
      accepted,
      customerLookupState,
      warnings
    );
    customerProfilesRequested = customerResult.requested;
    customerProfilesReceived = customerResult.received;
    customerProfilesEmpty = customerResult.empty || 0;
    customerProfilesUnavailable = customerResult.unavailable || 0;
    customerProfilesCanonicalized = customerResult.canonicalized || 0;
    accepted = accepted.map((payment) => ({
      ...payment,
      customer: payment.customerExternalId
        ? customerResult.profiles.get(payment.customerExternalId) || null
        : null,
    }));
  }
  return {
    received: source.length,
    accepted,
    cursor: asString(payload?.cursor, 10_000) || null,
    customerProfilesRequested,
    customerProfilesReceived,
    customerProfilesEmpty,
    customerProfilesUnavailable,
    customerProfilesCanonicalized,
    paymentNameHintsReceived,
  };
}

export async function syncSquareProvider(env, options = {}) {
  const provider = "square";
  const stats = createStats();
  const warnings = [];
  let checkpoint = null;
  const records = emptyRecords(provider);
  try {
    const parsedCheckpoint = parseCheckpoint(options.checkpoint, provider);
    checkpoint = squareCheckpoint(env, options, parsedCheckpoint);
    const locations = squareLocations(env);
    const tasks = squareTasks(locations);
    const customerLookupState = { disabled: false };
    const pageBudget = clampInteger(
      options.maxPages,
      PROVIDER_SYNC_LIMITS.defaultPages,
      1,
      PROVIDER_SYNC_LIMITS.maxPages
    );
    const collectRecords = options.collectRecords !== false;

    while (!checkpoint.complete && stats.pages < pageBudget) {
      const task = tasks[checkpoint.taskIndex];
      const location = locations.find((entry) => entry.key === task?.locationKey);
      if (!task || !location) {
        throw new ProviderSyncError(
          "square_location_changed",
          "Square locations changed while a sync checkpoint was active."
        );
      }
      const page = await squarePage(
        env,
        options,
        checkpoint,
        task,
        location,
        customerLookupState,
        warnings
      );
      const nextCheckpoint = nextTaskCheckpoint(
        checkpoint,
        tasks.length,
        page.cursor
      );
      const pageRecords =
        task.resource === "payments"
          ? { payments: page.accepted, refunds: [] }
          : { payments: [], refunds: page.accepted };
      const persisted = await emitBatch(
        options,
        provider,
        pageRecords,
        nextCheckpoint,
        {
          resource: task.resource,
          locationKey: task.locationKey,
          page: stats.pages + 1,
          customerProfilesRequested: page.customerProfilesRequested,
          customerProfilesReceived: page.customerProfilesReceived,
          customerProfilesEmpty: page.customerProfilesEmpty,
          customerProfilesUnavailable: page.customerProfilesUnavailable,
          customerProfilesCanonicalized: page.customerProfilesCanonicalized,
          paymentNameHintsReceived: page.paymentNameHintsReceived,
        }
      );
      if (persisted) stats.persistedPages += 1;
      if (collectRecords) appendRecords(records, pageRecords);
      stats.pages += 1;
      stats.received += page.received;
      stats.accepted += page.accepted.length;
      stats.skipped += page.received - page.accepted.length;
      stats.customerProfilesRequested =
        (stats.customerProfilesRequested || 0) + page.customerProfilesRequested;
      stats.customerProfilesReceived =
        (stats.customerProfilesReceived || 0) + page.customerProfilesReceived;
      stats.customerProfilesEmpty =
        (stats.customerProfilesEmpty || 0) + page.customerProfilesEmpty;
      stats.customerProfilesUnavailable =
        (stats.customerProfilesUnavailable || 0) + page.customerProfilesUnavailable;
      stats.customerProfilesCanonicalized =
        (stats.customerProfilesCanonicalized || 0) + page.customerProfilesCanonicalized;
      stats.paymentNameHintsReceived =
        (stats.paymentNameHintsReceived || 0) + page.paymentNameHintsReceived;
      checkpoint = nextCheckpoint;
    }

    stats.hasMore = !checkpoint.complete;
    return {
      ok: true,
      provider,
      records,
      checkpoint,
      stats,
      warnings,
      error: null,
    };
  } catch (error) {
    stats.hasMore = Boolean(checkpoint && !checkpoint.complete);
    return failedResult(provider, error, checkpoint, stats, warnings, records);
  }
}

function normalizeShopifyDomain(value) {
  let domain = asString(value, 500).toLowerCase();
  domain = domain.replace(/^https?:\/\//, "").split("/")[0];
  if (!/^[a-z0-9][a-z0-9.-]*\.myshopify\.com$/.test(domain)) return "";
  return domain;
}

function shopifyConfig(env) {
  const domain = normalizeShopifyDomain(env.SHOPIFY_STORE_DOMAIN);
  const token = asString(env.SHOPIFY_ADMIN_ACCESS_TOKEN, 10_000);
  const suppliedVersion = asString(env.SHOPIFY_ADMIN_API_VERSION, 20);
  const apiVersion = /^\d{4}-\d{2}$/.test(suppliedVersion)
    ? suppliedVersion
    : SHOPIFY_ADMIN_API_VERSION;
  if (!domain || !token) {
    throw new ProviderSyncError(
      "shopify_not_configured",
      "Shopify sync requires SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_ACCESS_TOKEN."
    );
  }
  return {
    domain,
    token,
    apiVersion,
    endpoint: `https://${domain}/admin/api/${apiVersion}/graphql.json`,
  };
}

function shopifyCheckpoint(options, parsedCheckpoint) {
  const window = syncWindow(
    "shopify",
    options,
    parsedCheckpoint,
    "2000-01-01T00:00:00.000Z"
  );
  if (parsedCheckpoint && !parsedCheckpoint.complete) {
    return {
      version: 1,
      provider: "shopify",
      complete: false,
      mode: window.mode,
      windowStart: window.windowStart,
      windowEnd: window.windowEnd,
      taskIndex: clampInteger(parsedCheckpoint.taskIndex, 0, 0, 2),
      cursor: asString(parsedCheckpoint.cursor, 10_000) || null,
    };
  }
  return {
    version: 1,
    provider: "shopify",
    complete: false,
    mode: window.mode,
    windowStart: window.windowStart,
    windowEnd: window.windowEnd,
    taskIndex: 0,
    cursor: null,
  };
}

function shopifySearchQuery(state) {
  const upper = `updated_at:<='${state.windowEnd}'`;
  return state.mode === "full"
    ? upper
    : `updated_at:>='${state.windowStart}' ${upper}`;
}

async function shopifyGraphql(env, options, query, variables) {
  const config = shopifyConfig(env);
  const { response, payload } = await fetchJson(
    config.endpoint,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-shopify-access-token": config.token,
      },
      body: JSON.stringify({ query, variables }),
    },
    options
  );
  if (!response.ok) throw httpError("shopify", response, payload);
  if (safeArray(payload?.errors, 10).length) {
    const errors = safeArray(payload.errors, 3);
    const throttled = errors.some(
      (entry) => asString(entry?.extensions?.code).toUpperCase() === "THROTTLED"
    );
    const message =
      errors
        .map((entry) => asString(entry?.message, 300))
        .filter(Boolean)
        .join("; ") || "Shopify GraphQL returned an error.";
    throw new ProviderSyncError("shopify_graphql_error", message, {
      status: throttled ? 429 : 400,
      retryable: throttled,
    });
  }
  if (!payload?.data) {
    throw new ProviderSyncError(
      "shopify_invalid_response",
      "Shopify GraphQL returned no data.",
      { retryable: true }
    );
  }
  return payload;
}

function normalizeShopifyContact(customer, fallback = {}) {
  const email = customer?.defaultEmailAddress?.emailAddress || fallback.email;
  const phone = customer?.defaultPhoneNumber?.phoneNumber || fallback.phone;
  return {
    externalId: asString(customer?.id, 500) || null,
    displayName:
      asString(customer?.displayName, 500) ||
      asString(`${customer?.firstName || ""} ${customer?.lastName || ""}`, 500) ||
      normalizeEmail(email) ||
      normalizePhone(phone) ||
      null,
    firstName: asString(customer?.firstName, 200) || null,
    lastName: asString(customer?.lastName, 200) || null,
    email: normalizeEmail(email) || null,
    phone: normalizePhone(phone) || null,
    verifiedEmail:
      typeof customer?.verifiedEmail === "boolean"
        ? customer.verifiedEmail
        : null,
    emailMarketingStatus: normalizeMarketingStatus(
      customer?.defaultEmailAddress?.marketingState
    ),
    emailMarketingProviderStatus:
      asString(customer?.defaultEmailAddress?.marketingState, 80).toLowerCase() ||
      null,
    emailMarketingUpdatedAt:
      safeIso(customer?.defaultEmailAddress?.marketingUpdatedAt),
    smsMarketingStatus: normalizeMarketingStatus(
      customer?.defaultPhoneNumber?.marketingState
    ),
    smsMarketingProviderStatus:
      asString(customer?.defaultPhoneNumber?.marketingState, 80).toLowerCase() ||
      null,
  };
}

function normalizeShopifyTransaction(transaction) {
  const money = moneyObject(transaction?.amountSet);
  return {
    externalId: asString(transaction?.id, 500),
    kind: asString(transaction?.kind, 80).toLowerCase(),
    status: asString(transaction?.status, 80).toLowerCase(),
    gateway: asString(transaction?.gateway, 200) || null,
    amount: money,
    occurredAt: safeIso(transaction?.processedAt || transaction?.createdAt),
  };
}

function settledShopifyTransactions(transactions, kinds) {
  return safeArray(transactions, 50)
    .filter(
      (entry) =>
        asString(entry?.status).toUpperCase() === "SUCCESS" &&
        kinds.has(asString(entry?.kind).toUpperCase())
    )
    .map(normalizeShopifyTransaction)
    .filter((entry) => entry.externalId && entry.amount);
}

function normalizeShopifyRefund(refund) {
  const transactions = safeArray(refund?.transactions?.nodes, 25);
  const settledTransactions = settledShopifyTransactions(
    transactions,
    new Set(["REFUND"])
  );
  return {
    externalId: asString(refund?.id, 500),
    occurredAt: safeIso(refund?.processedAt || refund?.createdAt),
    updatedAt: safeIso(refund?.updatedAt),
    providerTotal: moneyObject(refund?.totalRefundedSet),
    settled: settledTransactions.length > 0,
    settledTransactions,
    transactionsTruncated: Boolean(refund?.transactions?.pageInfo?.hasNextPage),
  };
}

function normalizeShopifyLineItem(lineItem) {
  const product = lineItem?.variant?.product || null;
  return {
    externalId: asString(lineItem?.id, 500),
    name: asString(lineItem?.name, 500) || "Merch item",
    quantity: clampInteger(lineItem?.quantity, 0, 0, 100_000),
    originalTotal: moneyObject(lineItem?.originalTotalSet),
    discountedTotal: moneyObject(lineItem?.discountedTotalSet),
    variantExternalId: asString(lineItem?.variant?.id, 500) || null,
    productExternalId: asString(product?.id, 500) || null,
    productHandle: asString(product?.handle, 300) || null,
    productType: asString(product?.productType, 300) || null,
    productTags: safeArray(product?.tags, 100)
      .map((tag) => asString(tag, 200))
      .filter(Boolean),
  };
}

function normalizeShopifyOrder(order) {
  const paymentTransactions = settledShopifyTransactions(
    order?.transactions,
    new Set(["SALE", "CAPTURE"])
  );
  const refunds = safeArray(order?.refunds, 100)
    .map(normalizeShopifyRefund)
    .filter((entry) => entry.externalId);
  return {
    externalId: asString(order?.id, 500),
    name: asString(order?.name, 300) || null,
    provider: "shopify",
    sourceType: "order",
    nodeId: "node-merch",
    contact: normalizeShopifyContact(order?.customer, {
      email: order?.email,
      phone: order?.phone,
    }),
    financialStatus:
      asString(order?.displayFinancialStatus, 80).toLowerCase() || null,
    fullyPaid: Boolean(order?.fullyPaid),
    unpaid: Boolean(order?.unpaid),
    test: Boolean(order?.test),
    sourceName: asString(order?.sourceName, 200) || null,
    tags: safeArray(order?.tags, 100)
      .map((tag) => asString(tag, 200))
      .filter(Boolean),
    currentTotal: moneyObject(order?.currentTotalPriceSet),
    totalReceived: moneyObject(order?.totalReceivedSet),
    totalRefunded: moneyObject(order?.totalRefundedSet),
    totalTip: moneyObject(order?.totalTipReceivedSet),
    settledPaymentTransactions: paymentTransactions,
    refunds,
    lineItems: safeArray(order?.lineItems?.nodes, 50)
      .map(normalizeShopifyLineItem)
      .filter((entry) => entry.externalId),
    lineItemsTruncated: Boolean(order?.lineItems?.pageInfo?.hasNextPage),
    occurredAt: safeIso(order?.processedAt || order?.createdAt),
    updatedAt: safeIso(order?.updatedAt),
    cancelledAt: safeIso(order?.cancelledAt),
  };
}

function normalizeShopifyCustomer(customer) {
  return {
    ...normalizeShopifyContact(customer),
    provider: "shopify",
    sourceType: "customer",
    state: asString(customer?.state, 80).toLowerCase() || null,
    tags: safeArray(customer?.tags, 100)
      .map((tag) => asString(tag, 200))
      .filter(Boolean),
    amountSpent: moneyObject(customer?.amountSpent),
    numberOfOrders: clampInteger(customer?.numberOfOrders, 0, 0, 10_000_000),
    createdAt: safeIso(customer?.createdAt),
    updatedAt: safeIso(customer?.updatedAt),
  };
}

async function shopifyPage(env, options, state, resource) {
  const isOrders = resource === "orders";
  const payload = await shopifyGraphql(
    env,
    options,
    isOrders ? SHOPIFY_ORDERS_QUERY : SHOPIFY_CUSTOMERS_QUERY,
    {
      first: isOrders
        ? PROVIDER_SYNC_LIMITS.shopifyOrderPageSize
        : PROVIDER_SYNC_LIMITS.shopifyCustomerPageSize,
      after: state.cursor || null,
      query: shopifySearchQuery(state),
    }
  );
  const connection = payload.data?.[resource];
  if (!connection || !connection.pageInfo) {
    throw new ProviderSyncError(
      "shopify_invalid_response",
      `Shopify returned an invalid ${resource} page.`,
      { retryable: true }
    );
  }
  const source = safeArray(
    connection.nodes,
    isOrders
      ? PROVIDER_SYNC_LIMITS.shopifyOrderPageSize
      : PROVIDER_SYNC_LIMITS.shopifyCustomerPageSize
  );
  const accepted = source
    .map(isOrders ? normalizeShopifyOrder : normalizeShopifyCustomer)
    .filter((entry) => entry.externalId);
  const cursor = connection.pageInfo.hasNextPage
    ? asString(connection.pageInfo.endCursor, 10_000)
    : "";
  if (connection.pageInfo.hasNextPage && !cursor) {
    throw new ProviderSyncError(
      "shopify_missing_cursor",
      `Shopify indicated more ${resource} without returning a cursor.`,
      { retryable: true }
    );
  }
  const available = Number(
    payload?.extensions?.cost?.throttleStatus?.currentlyAvailable
  );
  return {
    received: source.length,
    accepted,
    cursor: cursor || null,
    throttleLow: Number.isFinite(available) && available < 100,
  };
}

export async function syncShopifyProvider(env, options = {}) {
  const provider = "shopify";
  const stats = createStats();
  const warnings = [];
  let checkpoint = null;
  const records = emptyRecords(provider);
  try {
    shopifyConfig(env);
    const parsedCheckpoint = parseCheckpoint(options.checkpoint, provider);
    checkpoint = shopifyCheckpoint(options, parsedCheckpoint);
    const tasks = ["orders", "customers"];
    const pageBudget = clampInteger(
      options.maxPages,
      PROVIDER_SYNC_LIMITS.defaultPages,
      1,
      PROVIDER_SYNC_LIMITS.maxPages
    );
    const collectRecords = options.collectRecords !== false;

    while (!checkpoint.complete && stats.pages < pageBudget) {
      const resource = tasks[checkpoint.taskIndex];
      if (!resource) {
        throw new ProviderSyncError(
          "invalid_checkpoint",
          "The saved Shopify task index is invalid."
        );
      }
      const page = await shopifyPage(env, options, checkpoint, resource);
      const nextCheckpoint = nextTaskCheckpoint(
        checkpoint,
        tasks.length,
        page.cursor
      );
      const pageRecords =
        resource === "orders"
          ? { orders: page.accepted, customers: [] }
          : { orders: [], customers: page.accepted };
      const persisted = await emitBatch(
        options,
        provider,
        pageRecords,
        nextCheckpoint,
        { resource, page: stats.pages + 1 }
      );
      if (persisted) stats.persistedPages += 1;
      if (collectRecords) appendRecords(records, pageRecords);
      stats.pages += 1;
      stats.received += page.received;
      stats.accepted += page.accepted.length;
      stats.skipped += page.received - page.accepted.length;
      if (
        page.throttleLow &&
        !warnings.includes("Shopify API capacity is low; resume from the checkpoint.")
      ) {
        warnings.push("Shopify API capacity is low; resume from the checkpoint.");
      }
      checkpoint = nextCheckpoint;
    }

    stats.hasMore = !checkpoint.complete;
    return {
      ok: true,
      provider,
      records,
      checkpoint,
      stats,
      warnings,
      error: null,
    };
  } catch (error) {
    stats.hasMore = Boolean(checkpoint && !checkpoint.complete);
    return failedResult(provider, error, checkpoint, stats, warnings, records);
  }
}

function parsePublicationIds(value) {
  if (Array.isArray(value)) return uniqueStrings(value);
  const text = asString(value, 20_000);
  if (!text) return [];
  if (text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return uniqueStrings(parsed);
    } catch {
      // Fall through to comma/newline parsing for a friendlier configuration.
    }
  }
  return uniqueStrings(text.split(/[\s,;]+/));
}

function beehiivConfig(env) {
  const token = asString(env.BEEHIIV_API_KEY || env.BEEHIIV_ACCESS_TOKEN, 10_000);
  const publicationIds = parsePublicationIds(
    env.BEEHIIV_PUBLICATION_IDS || env.BEEHIIV_PUBLICATION_ID
  );
  if (!token || publicationIds.length === 0) {
    throw new ProviderSyncError(
      "beehiiv_not_configured",
      "beehiiv sync requires BEEHIIV_API_KEY and BEEHIIV_PUBLICATION_IDS."
    );
  }
  return { token, publicationIds };
}

function beehiivCheckpoint(env, options, parsedCheckpoint) {
  const config = beehiivConfig(env);
  if (parsedCheckpoint && !parsedCheckpoint.complete) {
    const publications = safeArray(parsedCheckpoint.publications, 100).map((value) =>
      asString(value, 500)
    );
    if (
      publications.length !== config.publicationIds.length ||
      publications.some((value, index) => value !== config.publicationIds[index])
    ) {
      throw new ProviderSyncError(
        "beehiiv_publications_changed",
        "beehiiv publications changed while a sync checkpoint was active."
      );
    }
    return {
      version: 1,
      provider: "beehiiv",
      complete: false,
      mode: "snapshot",
      windowEnd: safeIso(parsedCheckpoint.windowEnd) || nowIso(options),
      publications,
      taskIndex: clampInteger(
        parsedCheckpoint.taskIndex,
        0,
        0,
        publications.length
      ),
      cursor: asString(parsedCheckpoint.cursor, 10_000) || null,
    };
  }
  return {
    version: 1,
    provider: "beehiiv",
    complete: false,
    mode: "snapshot",
    windowEnd: nowIso(options),
    publications: config.publicationIds,
    taskIndex: 0,
    cursor: null,
  };
}

function epochToIso(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return safeIso(number * 1000);
}

function normalizeBeehiivSubscription(subscription, publicationId) {
  const providerStatus =
    asString(subscription?.status, 80).toLowerCase() || "unknown";
  const newsletterLists = Array.isArray(subscription?.newsletter_list_ids)
    ? subscription.newsletter_list_ids
    : safeArray(subscription?.newsletter_lists, 100).map(
        (entry) => entry?.id || entry
      );
  return {
    externalId: asString(subscription?.id, 500),
    provider: "beehiiv",
    sourceType: "subscription",
    publicationId,
    email: normalizeEmail(subscription?.email) || null,
    status: normalizeMarketingStatus(providerStatus),
    providerStatus,
    tier:
      asString(subscription?.subscription_tier, 80).toLowerCase() || "unknown",
    premiumTierNames: safeArray(
      subscription?.subscription_premium_tier_names,
      25
    )
      .map((value) => asString(value, 200))
      .filter(Boolean),
    newsletterListIds: safeArray(newsletterLists, 100)
      .map((value) => asString(value, 500))
      .filter(Boolean),
    referralCode: asString(subscription?.referral_code, 500) || null,
    subscribedAt: epochToIso(subscription?.created),
    updatedAt: safeIso(subscription?.updated),
  };
}

async function beehiivPage(env, options, checkpoint, publicationId) {
  const config = beehiivConfig(env);
  const url = new URL(
    `/v2/publications/${encodeURIComponent(publicationId)}/subscriptions`,
    "https://api.beehiiv.com"
  );
  url.searchParams.set("limit", String(PROVIDER_SYNC_LIMITS.beehiivPageSize));
  url.searchParams.set("status", "all");
  url.searchParams.set("tier", "all");
  url.searchParams.set("order_by", "created");
  url.searchParams.set("direction", "asc");
  url.searchParams.append("expand[]", "newsletter_lists");
  if (checkpoint.cursor) url.searchParams.set("cursor", checkpoint.cursor);

  const { response, payload } = await fetchJson(
    url,
    {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${config.token}`,
      },
    },
    options
  );
  if (!response.ok) throw httpError("beehiiv", response, payload);
  const source = safeArray(payload?.data, PROVIDER_SYNC_LIMITS.beehiivPageSize);
  const accepted = source
    .map((entry) => normalizeBeehiivSubscription(entry, publicationId))
    .filter((entry) => entry.externalId && entry.email);
  const hasMore = Boolean(payload?.has_more ?? payload?.pagination?.has_more);
  const cursor = asString(
    payload?.next_cursor ?? payload?.pagination?.next_cursor,
    10_000
  );
  if (hasMore && !cursor) {
    throw new ProviderSyncError(
      "beehiiv_missing_cursor",
      "beehiiv indicated more subscriptions without returning a cursor.",
      { retryable: true }
    );
  }
  return {
    received: source.length,
    accepted,
    cursor: hasMore ? cursor : null,
  };
}

export async function syncBeehiivProvider(env, options = {}) {
  const provider = "beehiiv";
  const stats = createStats();
  const warnings = [
    "beehiiv reconciliation is a bounded full snapshot because subscription updates do not expose an updated-time cursor.",
  ];
  let checkpoint = null;
  const records = emptyRecords(provider);
  try {
    const parsedCheckpoint = parseCheckpoint(options.checkpoint, provider);
    checkpoint = beehiivCheckpoint(env, options, parsedCheckpoint);
    const config = beehiivConfig(env);
    const pageBudget = clampInteger(
      options.maxPages,
      PROVIDER_SYNC_LIMITS.defaultPages,
      1,
      PROVIDER_SYNC_LIMITS.maxPages
    );
    const collectRecords = options.collectRecords !== false;

    while (!checkpoint.complete && stats.pages < pageBudget) {
      const publicationId = checkpoint.publications[checkpoint.taskIndex];
      if (!publicationId) {
        throw new ProviderSyncError(
          "invalid_checkpoint",
          "The saved beehiiv publication index is invalid."
        );
      }
      const page = await beehiivPage(env, options, checkpoint, publicationId);
      const nextCheckpoint = nextTaskCheckpoint(
        checkpoint,
        config.publicationIds.length,
        page.cursor
      );
      const pageRecords = { subscriptions: page.accepted };
      const persisted = await emitBatch(
        options,
        provider,
        pageRecords,
        nextCheckpoint,
        { resource: "subscriptions", publicationId, page: stats.pages + 1 }
      );
      if (persisted) stats.persistedPages += 1;
      if (collectRecords) appendRecords(records, pageRecords);
      stats.pages += 1;
      stats.received += page.received;
      stats.accepted += page.accepted.length;
      stats.skipped += page.received - page.accepted.length;
      checkpoint = nextCheckpoint;
    }

    stats.hasMore = !checkpoint.complete;
    return {
      ok: true,
      provider,
      records,
      checkpoint,
      stats,
      warnings,
      error: null,
    };
  } catch (error) {
    stats.hasMore = Boolean(checkpoint && !checkpoint.complete);
    return failedResult(provider, error, checkpoint, stats, warnings, records);
  }
}

function readinessItem(id, label, mode, configured, missing, details) {
  return {
    id,
    label,
    mode,
    configured: Boolean(configured),
    ready: Boolean(configured) || mode === "csv",
    status:
      mode === "csv"
        ? "manual"
        : configured
          ? "ready"
          : "needs_attention",
    missing,
    details,
  };
}

export function getCrmProviderStatus(env) {
  const locations = squareLocations(env);
  const shopifyDomain = normalizeShopifyDomain(env.SHOPIFY_STORE_DOMAIN);
  const shopifyVersion = /^\d{4}-\d{2}$/.test(
    asString(env.SHOPIFY_ADMIN_API_VERSION, 20)
  )
    ? asString(env.SHOPIFY_ADMIN_API_VERSION, 20)
    : SHOPIFY_ADMIN_API_VERSION;
  const publicationIds = parsePublicationIds(
    env.BEEHIIV_PUBLICATION_IDS || env.BEEHIIV_PUBLICATION_ID
  );
  const squareMissing = [];
  if (!asString(env.SQUARE_ACCESS_TOKEN)) squareMissing.push("SQUARE_ACCESS_TOKEN");
  if (locations.length === 0) {
    squareMissing.push(
      "SQUARE_LOCATION_ID or SQUARE_STUDIO_LOCATION_ID or SQUARE_EVENTS_LOCATION_ID"
    );
  }
  const shopifyMissing = [];
  if (!shopifyDomain) shopifyMissing.push("SHOPIFY_STORE_DOMAIN");
  if (!asString(env.SHOPIFY_ADMIN_ACCESS_TOKEN)) {
    shopifyMissing.push("SHOPIFY_ADMIN_ACCESS_TOKEN");
  }
  const beehiivMissing = [];
  if (!asString(env.BEEHIIV_API_KEY || env.BEEHIIV_ACCESS_TOKEN)) {
    beehiivMissing.push("BEEHIIV_API_KEY");
  }
  if (publicationIds.length === 0) {
    beehiivMissing.push("BEEHIIV_PUBLICATION_IDS");
  }

  const providers = [
    readinessItem(
      "square",
      "Square",
      "api",
      squareMissing.length === 0,
      squareMissing,
      {
        environment:
          env.SQUARE_ENVIRONMENT === "production" ? "production" : "sandbox",
        configuredLocations: locations.map((entry) => entry.key),
        apiVersion: SQUARE_API_VERSION,
        requiredScopes: CRM_PROVIDER_ENV.square.requiredScopes,
      }
    ),
    readinessItem(
      "shopify",
      "Shopify",
      "api",
      shopifyMissing.length === 0,
      shopifyMissing,
      {
        storeDomain: shopifyDomain || null,
        apiVersion: shopifyVersion,
        requiredScopes: CRM_PROVIDER_ENV.shopify.requiredScopes,
      }
    ),
    readinessItem(
      "beehiiv",
      "beehiiv",
      "api",
      beehiivMissing.length === 0,
      beehiivMissing,
      {
        publicationCount: publicationIds.length,
        requiredScopes: CRM_PROVIDER_ENV.beehiiv.requiredScopes,
      }
    ),
    readinessItem("substack", "Substack", "csv", true, [], {
      importOnly: true,
      message: "Substack subscriber identity sync uses Studio CSV imports.",
    }),
  ];
  return {
    generatedAt: new Date().toISOString(),
    readyCount: providers.filter((provider) => provider.ready).length,
    providers,
  };
}

export async function syncCrmProvider(provider, env, options = {}) {
  const id = asString(provider, 80).toLowerCase();
  if (id === "square") return syncSquareProvider(env, options);
  if (id === "shopify") return syncShopifyProvider(env, options);
  if (id === "beehiiv") return syncBeehiivProvider(env, options);
  if (id === "substack") {
    return failedResult(
      "substack",
      new ProviderSyncError(
        "substack_csv_required",
        "Substack subscriber identities must be imported from a CSV export."
      )
    );
  }
  return failedResult(
    id || "unknown",
    new ProviderSyncError("unknown_provider", "Unknown CRM provider.")
  );
}
