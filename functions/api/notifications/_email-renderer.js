const SHARED = Object.freeze({
  background: "#0E0E0E",
  panel: "#151515",
  body: "#FFE7CA",
  muted: "#D6C0A6",
  dim: "#9C8B78",
  amber: "#FCB467",
});

const THEMES = Object.freeze({
  tattoo: {
    id: "tattoo",
    brand: "art.pill TATTOO HOUSE",
    accent: "#6E0404",
    accentBright: "#9A2323",
    buttonText: SHARED.body,
  },
  construct_event: {
    id: "construct_event",
    brand: "the six.well construct",
    accent: "#005D25",
    accentBright: "#397F34",
    buttonText: SHARED.body,
  },
  construct_studio: {
    id: "construct_studio",
    brand: "the six.well construct",
    accent: SHARED.amber,
    accentBright: SHARED.amber,
    buttonText: SHARED.background,
  },
});

function value(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

export function escapeEmailHtml(input) {
  return String(input ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[char]));
}

function safeUrl(input) {
  const raw = value(input);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (!["https:", "http:", "mailto:"].includes(url.protocol)) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function htmlText(input) {
  return escapeEmailHtml(input).replace(/\n/g, "<br>");
}

function compact(items) {
  return (Array.isArray(items) ? items : []).filter((item) => {
    if (typeof item === "string") return Boolean(value(item));
    return Boolean(item);
  });
}

function themeFor(id) {
  return THEMES[id] || THEMES.tattoo;
}

function renderParagraphs(paragraphs) {
  return compact(paragraphs).map((paragraph) => `
    <p style="margin:0 0 18px;color:${SHARED.body};font-family:Georgia,'Times New Roman',Times,serif;font-size:16px;line-height:1.65;">
      ${htmlText(paragraph)}
    </p>`).join("");
}

function renderDetails(details, theme) {
  const rows = compact(details).filter((detail) => value(detail?.label) && value(detail?.value));
  if (!rows.length) return "";
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border:5px solid ${theme.accent};border-collapse:collapse;margin:6px 0 28px;">
      ${rows.map((detail, index) => `
        <tr>
          <td class="detail-label" width="36%" valign="top" style="width:36%;padding:14px 16px;${index ? `border-top:5px solid ${theme.accent};` : ""}color:${SHARED.dim};font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:700;letter-spacing:.16em;line-height:1.5;text-transform:uppercase;">
            ${htmlText(detail.label)}
          </td>
          <td class="detail-value" width="64%" valign="top" style="width:64%;padding:14px 16px;${index ? `border-top:5px solid ${theme.accent};` : ""}color:${SHARED.body};font-family:Georgia,'Times New Roman',Times,serif;font-size:15px;line-height:1.55;">
            ${htmlText(detail.value)}
          </td>
        </tr>`).join("")}
    </table>`;
}

function renderSection(section, theme) {
  const title = value(section?.title);
  const paragraphs = compact(section?.paragraphs);
  const items = compact(section?.items).filter((item) => value(item?.label) || value(item?.value) || value(item?.href));
  if (!title && !paragraphs.length && !items.length) return "";

  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin:0 0 26px;">
      ${title ? `<tr><td style="padding:0 0 10px;color:${theme.accentBright};font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:.18em;line-height:1.5;text-transform:uppercase;">${htmlText(title)}</td></tr>` : ""}
      ${paragraphs.length ? `<tr><td>${renderParagraphs(paragraphs)}</td></tr>` : ""}
      ${items.length ? `<tr><td>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;">
          ${items.map((item, index) => {
            const href = safeUrl(item.href);
            const itemValue = value(item.value) || href;
            return `
              <tr>
                <td valign="top" style="padding:${index ? "12px" : "0"} 0 0;color:${SHARED.muted};font-family:Georgia,'Times New Roman',Times,serif;font-size:15px;line-height:1.6;">
                  ${value(item.label) ? `<strong style="color:${SHARED.body};font-weight:normal;">${htmlText(item.label)}:</strong> ` : ""}
                  ${href ? `<a href="${escapeEmailHtml(href)}" style="color:${SHARED.amber};text-decoration:underline;word-break:break-word;">${htmlText(itemValue)}</a>` : htmlText(itemValue)}
                </td>
              </tr>`;
          }).join("")}
        </table>
      </td></tr>` : ""}
    </table>`;
}

function renderPrimaryAction(action, theme) {
  const href = safeUrl(action?.href);
  const label = value(action?.label);
  if (!href || !label) return "";
  return `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:2px 0 28px;">
      <tr>
        <td bgcolor="${theme.accentBright}" style="background:${theme.accentBright};border:5px solid ${theme.accentBright};">
          <a href="${escapeEmailHtml(href)}" style="display:inline-block;padding:13px 20px;color:${theme.buttonText};font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;letter-spacing:.14em;line-height:1.25;text-decoration:none;text-transform:uppercase;">
            ${htmlText(label)}
          </a>
        </td>
      </tr>
      <tr>
        <td style="padding-top:10px;color:${SHARED.dim};font-family:Arial,Helvetica,sans-serif;font-size:10px;line-height:1.5;word-break:break-all;">
          If the button does not open, use:<br>
          <a href="${escapeEmailHtml(href)}" style="color:${SHARED.muted};text-decoration:underline;">${htmlText(href)}</a>
        </td>
      </tr>
    </table>`;
}

function renderSecondaryActions(actions) {
  const valid = compact(actions).map((action) => ({
    label: value(action?.label),
    href: safeUrl(action?.href),
  })).filter((action) => action.label && action.href);
  if (!valid.length) return "";
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin:0 0 28px;">
      ${valid.map((action, index) => `
        <tr>
          <td style="padding:${index ? "12px" : "0"} 0 0;color:${SHARED.muted};font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:.08em;line-height:1.5;text-transform:uppercase;">
            <a href="${escapeEmailHtml(action.href)}" style="color:${SHARED.amber};text-decoration:underline;">${htmlText(action.label)}</a>
            <span style="display:block;padding-top:3px;color:${SHARED.dim};font-family:Georgia,'Times New Roman',Times,serif;font-size:12px;letter-spacing:0;text-transform:none;word-break:break-all;">${htmlText(action.href)}</span>
          </td>
        </tr>`).join("")}
    </table>`;
}

function renderNotice(notice, theme) {
  const lines = compact(notice);
  if (!lines.length) return "";
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin:0 0 28px;border-left:5px solid ${theme.accentBright};background:${SHARED.panel};">
      <tr>
        <td style="padding:16px 18px;color:${SHARED.muted};font-family:Georgia,'Times New Roman',Times,serif;font-size:14px;line-height:1.65;">
          ${lines.map(htmlText).join("<br><br>")}
        </td>
      </tr>
    </table>`;
}

function renderHero(heroImage, theme) {
  const src = safeUrl(heroImage?.src);
  if (!src) return "";
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin:0 0 28px;border:5px solid ${theme.accent};">
      <tr>
        <td>
          <img src="${escapeEmailHtml(src)}" width="610" alt="${escapeEmailHtml(value(heroImage.alt))}" style="display:block;width:100%;max-width:610px;height:auto;border:0;">
        </td>
      </tr>
    </table>`;
}

function renderText(message, theme) {
  const lines = [];
  const push = (...values) => values.forEach((item) => {
    const text = value(item);
    if (text) lines.push(text);
  });
  const gap = () => {
    if (lines.length && lines.at(-1) !== "") lines.push("");
  };

  push(message.classification);
  gap();
  push(message.greeting);
  push(message.headline);
  if (compact(message.intro).length) {
    gap();
    compact(message.intro).forEach((paragraph, index) => {
      if (index) gap();
      push(paragraph);
    });
  }
  if (compact(message.details).length) {
    gap();
    compact(message.details).forEach((detail) => {
      if (value(detail?.label) && value(detail?.value)) push(`${value(detail.label)}: ${value(detail.value)}`);
    });
  }
  compact(message.sections).forEach((section) => {
    const paragraphs = compact(section?.paragraphs);
    const items = compact(section?.items);
    if (!value(section?.title) && !paragraphs.length && !items.length) return;
    gap();
    push(section.title);
    paragraphs.forEach((paragraph, index) => {
      if (index) gap();
      push(paragraph);
    });
    items.forEach((item) => {
      const href = safeUrl(item?.href);
      const itemValue = value(item?.value) || href;
      if (!itemValue) return;
      push(value(item?.label) ? `${value(item.label)}: ${itemValue}` : itemValue);
    });
  });
  const primaryHref = safeUrl(message.primaryAction?.href);
  if (value(message.primaryAction?.label) && primaryHref) {
    gap();
    push(`${value(message.primaryAction.label)}:`, primaryHref);
  }
  const secondaryActions = compact(message.secondaryActions).filter((action) => safeUrl(action?.href));
  if (secondaryActions.length) {
    gap();
    secondaryActions.forEach((action) => push(`${value(action.label)}: ${safeUrl(action.href)}`));
  }
  if (compact(message.notice).length) {
    gap();
    compact(message.notice).forEach((line, index) => {
      if (index) gap();
      push(line);
    });
  }
  if (compact(message.outro).length) {
    gap();
    compact(message.outro).forEach((line, index) => {
      if (index) gap();
      push(line);
    });
  }
  if (message.signature) {
    gap();
    push(message.signature.closing, message.signature.name, message.signature.mark || theme.brand);
  }
  if (compact(message.footer).length) {
    gap();
    compact(message.footer).forEach(push);
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function renderClientEmail(message) {
  const theme = themeFor(message.theme);
  const subject = value(message.subject);
  const preheader = value(message.preheader);
  const sections = compact(message.sections);
  const text = renderText(message, theme);
  const hiddenPreheader = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${htmlText(preheader)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>`
    : "";
  const signature = message.signature ? `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin-top:8px;">
      <tr>
        <td style="color:${SHARED.muted};font-family:Georgia,'Times New Roman',Times,serif;font-size:15px;line-height:1.65;">
          ${value(message.signature.closing) ? `${htmlText(message.signature.closing)}<br>` : ""}
          ${value(message.signature.name) ? `<span style="color:${SHARED.body};">${htmlText(message.signature.name)}</span><br>` : ""}
          <span style="color:${theme.accentBright};font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;">${htmlText(message.signature.mark || theme.brand)}</span>
        </td>
      </tr>
    </table>` : "";

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <title>${escapeEmailHtml(subject)}</title>
  <style>
    body,table,td,p,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
    table,td{mso-table-lspace:0;mso-table-rspace:0}
    table{border-collapse:collapse!important}
    img{-ms-interpolation-mode:bicubic}
    @media only screen and (max-width:660px){
      .email-shell{width:100%!important}
      .email-pad{padding-left:20px!important;padding-right:20px!important}
      .email-title{font-size:30px!important}
      .detail-label,.detail-value{display:block!important;width:100%!important}
      .detail-value{padding-top:0!important;border-top:0!important}
    }
  </style>
</head>
<body style="margin:0;padding:0;background:${SHARED.background};color:${SHARED.body};">
  ${hiddenPreheader}
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${SHARED.background}" style="width:100%;background:${SHARED.background};">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" class="email-shell" width="620" cellspacing="0" cellpadding="0" border="0" style="width:620px;max-width:620px;background:${SHARED.background};">
          <tr>
            <td class="email-pad" style="padding:22px 30px 18px;border-bottom:5px solid ${theme.accent};">
              <span style="color:${SHARED.body};font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;letter-spacing:.16em;line-height:1.4;text-transform:uppercase;">${htmlText(theme.brand)}</span>
            </td>
          </tr>
          <tr>
            <td class="email-pad" style="padding:34px 30px 38px;">
              ${value(message.classification) ? `<div style="margin:0 0 12px;color:${theme.accentBright};font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:700;letter-spacing:.2em;line-height:1.5;text-transform:uppercase;">${htmlText(message.classification)}</div>` : ""}
              ${value(message.headline) ? `<h1 class="email-title" style="margin:0 0 22px;color:${SHARED.body};font-family:Arial,Helvetica,sans-serif;font-size:38px;font-weight:900;letter-spacing:-.045em;line-height:1.05;">${htmlText(message.headline)}</h1>` : ""}
              ${value(message.greeting) ? `<p style="margin:0 0 18px;color:${SHARED.body};font-family:Georgia,'Times New Roman',Times,serif;font-size:16px;line-height:1.65;">${htmlText(message.greeting)}</p>` : ""}
              ${renderHero(message.heroImage, theme)}
              ${renderParagraphs(message.intro)}
              ${renderDetails(message.details, theme)}
              ${sections.map((section) => renderSection(section, theme)).join("")}
              ${renderPrimaryAction(message.primaryAction, theme)}
              ${renderSecondaryActions(message.secondaryActions)}
              ${renderNotice(message.notice, theme)}
              ${renderParagraphs(message.outro)}
              ${signature}
            </td>
          </tr>
          <tr>
            <td class="email-pad" style="padding:18px 30px 24px;border-top:5px solid ${theme.accent};color:${SHARED.dim};font-family:Georgia,'Times New Roman',Times,serif;font-size:11px;line-height:1.65;">
              ${compact(message.footer).length ? compact(message.footer).map(htmlText).join("<br>") : `${htmlText(theme.brand)}<br>Transactional studio correspondence.`}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return {
    subject,
    preheader,
    text,
    html,
    theme: theme.id,
  };
}

export const CLIENT_EMAIL_THEMES = THEMES;
