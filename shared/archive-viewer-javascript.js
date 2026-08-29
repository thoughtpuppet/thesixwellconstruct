function regexLiteralMayStart(source, slashIndex) {
  let index = slashIndex - 1;
  while (index >= 0 && /\s/.test(source[index])) index -= 1;
  if (index < 0) return true;
  const previous = source[index];
  if (/[([{,:;=!?&|+\-*%^~<>]/.test(previous)) return true;
  if (!/[A-Za-z_$]/.test(previous)) return false;
  const end = index + 1;
  while (index >= 0 && /[A-Za-z0-9_$]/.test(source[index])) index -= 1;
  return /^(?:return|throw|case|delete|void|typeof|instanceof|in|of|yield|await|else|do)$/.test(source.slice(index + 1, end));
}

function maskJavaScriptNonCode(value, findings = null) {
  const source = String(value || ""), masked = source.split("");
  const blank = (index) => { if (masked[index] !== "\n" && masked[index] !== "\r") masked[index] = " "; };
  for (let index = 0; index < source.length;) {
    const character = source[index], next = source[index + 1];
    if (character === "'" || character === '"' || character === "`") {
      const quote = character, start = index;
      blank(index++);
      while (index < source.length) {
        const current = source[index];
        blank(index++);
        if (current === "\\" && index < source.length) { blank(index++); continue; }
        if (current === quote) break;
      }
      if (quote === "`" && findings) {
        const literal = source.slice(start, index);
        for (const expression of literal.matchAll(/\$\{([\s\S]*?)\}/g)) {
          const code = decodeIdentifierEscapes(expression[1]);
          const directNavigation = /\blocation\s*(?:\.|\?\.)\s*(?:assign|replace|reload)\s*(?:\?\.)?\s*\(|\blocation\s*(?:\.|\?\.)\s*(?:href|pathname|search|hash|protocol|host|hostname|port)\s*(?:\|\|=|&&=|\?\?=|\+=|-=|\*=|\/=|%=|=(?!=|>))|\blocation\s*=(?!=|>)|\bnavigation\s*(?:\.|\?\.)\s*(?:navigate|back|forward|reload|traverseTo)\s*(?:\?\.)?\s*\(|\bhistory\s*(?:\.|\?\.)\s*(?:go|back|forward)\s*(?:\?\.)?\s*\(/.test(code);
          const scriptConstruction = /\bcreateElement(?:NS)?\s*\([^)]*["'`]script["'`]/i.test(code);
          if (directNavigation || scriptConstruction || unrewritableJavaScriptNavigationFindings(code).length) {
            findings.add("template-expression-navigation");
            break;
          }
        }
      }
      continue;
    }
    if (character === "/" && next === "/") {
      blank(index++); blank(index++);
      while (index < source.length && source[index] !== "\n" && source[index] !== "\r") blank(index++);
      continue;
    }
    if (character === "/" && next === "*") {
      blank(index++); blank(index++);
      while (index < source.length) {
        const current = source[index], following = source[index + 1];
        blank(index++);
        if (current === "*" && following === "/") { blank(index++); break; }
      }
      continue;
    }
    if (character === "/" && regexLiteralMayStart(source, index)) {
      let inClass = false;
      blank(index++);
      while (index < source.length) {
        const current = source[index];
        blank(index++);
        if (current === "\\" && index < source.length) { blank(index++); continue; }
        if (current === "[") inClass = true;
        else if (current === "]") inClass = false;
        else if (current === "/" && !inClass) {
          while (index < source.length && /[A-Za-z]/.test(source[index])) blank(index++);
          break;
        }
        if (current === "\n" || current === "\r") break;
      }
      continue;
    }
    index += 1;
  }
  return masked.join("");
}

function decodeIdentifierEscapes(value) {
  return String(value || "").replace(/\\u(?:\{([0-9a-f]{1,6})\}|([0-9a-f]{4}))/gi, (whole, braced, fixed) => {
    const point = Number.parseInt(braced || fixed, 16);
    if (!Number.isSafeInteger(point) || point > 0x10ffff) return whole;
    try { return String.fromCodePoint(point); } catch { return whole; }
  });
}

function callArguments(source, masked, pattern) {
  const calls = [];
  for (const match of masked.matchAll(pattern)) {
    const open = match.index + match[0].lastIndexOf("(");
    const argumentsFound = [];
    let argumentStart = open + 1, depth = 0, closed = false;
    for (let index = open + 1; index < masked.length; index += 1) {
      const character = masked[index];
      if (character === "(" || character === "[" || character === "{") depth += 1;
      else if (character === ")") {
        if (!depth) {
          argumentsFound.push(source.slice(argumentStart, index).trim());
          argumentsFound.callStart = match.index;
          argumentsFound.callEnd = index + 1;
          closed = true;
          break;
        }
        depth -= 1;
      } else if (character === "]" || character === "}") {
        if (depth) depth -= 1;
      } else if (character === "," && !depth) {
        argumentsFound.push(source.slice(argumentStart, index).trim());
        argumentStart = index + 1;
      }
    }
    if (closed) calls.push(argumentsFound);
  }
  return calls;
}

function staticJavaScriptString(value) {
  const source = String(value || "").trim(), quote = source[0];
  if (!["'", '"', "`"].includes(quote) || source.at(-1) !== quote || (quote === "`" && source.includes("${"))) return null;
  let body = source.slice(1, -1);
  body = body
    .replace(/\\x([0-9a-f]{2})/gi, (_whole, digits) => String.fromCodePoint(Number.parseInt(digits, 16)))
    .replace(/\\u(?:\{([0-9a-f]{1,6})\}|([0-9a-f]{4}))/gi, (whole, braced, fixed) => {
      const point = Number.parseInt(braced || fixed, 16);
      try { return point <= 0x10ffff ? String.fromCodePoint(point) : whole; } catch { return whole; }
    })
    .replace(/\\([\\'"`])/g, "$1");
  return body;
}

function addDynamicCodeConstructionFindings(source, masked, findings) {
  for (const argumentsFound of callArguments(source, masked, /\bcreateElement\s*\(/g)) {
    const tagName = staticJavaScriptString(argumentsFound[0]);
    // A literal script element is deterministically rewritten to an inert
    // template element. Dynamic tag names still fail closed because they
    // cannot be proven safe without executing the historical program.
    if (tagName === null) findings.add("dynamic-script-construction");
  }
  for (const argumentsFound of callArguments(source, masked, /\bcreateElementNS\s*\(/g)) {
    const tagName = staticJavaScriptString(argumentsFound[1]);
    if (tagName === null) findings.add("dynamic-script-construction");
  }
  for (const argumentsFound of callArguments(source, masked, /\bsetAttribute\s*\(/g)) {
    const attributeName = staticJavaScriptString(argumentsFound[0]);
    if (attributeName === null || /^on/i.test(attributeName) || attributeName.toLowerCase() === "srcdoc") findings.add("dynamic-event-handler-construction");
  }
  for (const argumentsFound of callArguments(source, masked, /\bsetAttributeNS\s*\(/g)) {
    const attributeName = staticJavaScriptString(argumentsFound[1]);
    if (attributeName === null || /^on/i.test(attributeName) || attributeName.toLowerCase() === "srcdoc") findings.add("dynamic-event-handler-construction");
  }
  for (const argumentsFound of callArguments(source, masked, /\bcreateAttribute(?:NS)?\s*\(/g)) {
    const attributeName = staticJavaScriptString(argumentsFound.at(-1));
    if (attributeName === null || /^on/i.test(attributeName) || attributeName.toLowerCase() === "srcdoc") findings.add("dynamic-event-handler-construction");
  }
  for (const argumentsFound of callArguments(source, masked, /\b(?:setTimeout|setInterval)\s*\(/g)) {
    if (staticJavaScriptString(argumentsFound[0]) !== null) findings.add("string-code-evaluation");
  }
  const patterns = [
    ["dynamic-code-evaluation", /\b(?:eval|execScript|Function|WebAssembly)\b/],
    ["dynamic-script-construction", /\.\s*(?:text|textContent|innerText)\s*=\s*[^;\n]+\bscript\b|\bHTMLScriptElement\b/],
    ["dynamic-event-handler-construction", /\.\s*(?:setAttribute|setAttributeNS)\s*\.\s*(?:call|apply|bind)\b|\b(?:setAttributeNode|setNamedItem)\s*\(/],
    ["dynamic-markup-construction", /\.\s*(?:innerHTML|outerHTML|srcdoc)\s*=|\b(?:insertAdjacentHTML|createContextualFragment|createHTMLDocument|setHTML|setHTMLUnsafe|parseHTMLUnsafe|execCommand)\s*\(|\bDOMParser\b/],
    ["document-stream-write", /\bdocument\s*(?:\.|\?\.)\s*(?:open|write|writeln)\s*(?:\?\.)?\s*\(/],
  ];
  for (const [name, pattern] of patterns) if (pattern.test(masked)) findings.add(name);
}

function previousNonWhitespace(value, index) {
  let cursor = index - 1;
  while (cursor >= 0 && /\s/.test(value[cursor])) cursor -= 1;
  return cursor >= 0 ? value[cursor] : "";
}

const GLOBAL_CAPABILITY_ROOTS = new Set(["window", "self", "globalThis", "document", "top", "parent", "frames", "this"]);
const NAVIGATION_CAPABILITIES = new Set(["location", "history", "navigation"]);
const INDIRECT_GLOBAL_MEMBERS = new Set([
  "window", "self", "globalThis", "document", "top", "parent", "frames",
  "defaultView", "view", "contentWindow", "contentDocument", "ownerDocument",
]);

function navigationCapabilityTailIsSupported(capability, tail, qualifiedRoot) {
  const member = /^\s*(?:\?\.|\.)\s*([A-Za-z_$][\w$]*)/.exec(tail);
  if (!member) {
    return capability === "location" && qualifiedRoot
      && /^\s*(?:\|\|=|&&=|\?\?=|\+=|-=|\*=|\/=|%=|=(?!=|>))/.test(tail);
  }
  const property = member[1], remainder = tail.slice(member[0].length);
  if (["constructor", "prototype", "__proto__"].includes(property)) return false;
  const navigationMethods = capability === "location"
    ? new Set(["assign", "replace", "reload"])
    : capability === "history"
      ? new Set(["go", "back", "forward"])
      : new Set(["navigate", "back", "forward", "reload", "traverseTo"]);
  if (navigationMethods.has(property)) return /^\s*(?:\?\.)?\s*\(/.test(remainder);
  if (/^\s*(?:\?\.|\.)\s*(?:call|apply|bind)\b/.test(remainder)) return false;
  return true;
}

function addSupportedGlobalCapabilityFindings(source, masked, findings) {
  const decoded = decodeIdentifierEscapes(masked);
  if (decoded !== masked && /\b(?:window|self|globalThis|document|top|parent|frames|this|location|history|navigation)\b/.test(decoded)) {
    findings.add("escaped-global-capability");
  }

  const capabilityPattern = /\b(?:globalThis|navigation|document|location|history|window|frames|parent|self|this|top)\b/g;
  for (const match of masked.matchAll(capabilityPattern)) {
    const token = match[0], before = masked.slice(0, match.index), after = masked.slice(match.index + token.length);
    const qualifiedRoot = new RegExp(String.raw`(?:^|[^\w$])(?:window|self|globalThis|document|top|parent|frames|this)\s*(?:\?\.|\.)\s*$`).test(before);
    const arbitraryReceiver = /(?:[A-Za-z_$][\w$]*|\)|\])\s*(?:\?\.|\.)\s*$/.test(before) && !qualifiedRoot;

    if (NAVIGATION_CAPABILITIES.has(token)) {
      if (arbitraryReceiver || !navigationCapabilityTailIsSupported(token, after, qualifiedRoot)) {
        findings.add("unsupported-global-capability-context");
      }
      continue;
    }

    if (arbitraryReceiver) {
      // `top` is also an ordinary geometry/CSS property (DOMRect.top, style.top).
      // A later `.location`/`.history`/`.navigation` hop is still rejected below.
      if (token === "top") continue;
      findings.add("unsupported-global-capability-context");
      continue;
    }
    const member = /^\s*(?:\?\.|\.)\s*([A-Za-z_$][\w$]*)/.exec(after);
    if (!member) {
      // `top` is a frequent local geometry binding (`const { top } = rect`).
      // When the source declares it locally, subsequent bare uses refer to
      // that binding rather than the cross-frame global. Actual `top.location`
      // access still follows the global capability path and is rewritten.
      if (token === "top" && /\b(?:const|let|var)\s*(?:top\b|\{[^}\r\n]{0,1000}\btop\b[^}\r\n]{0,1000}\}\s*=)/.test(masked)) continue;
      findings.add("unsupported-global-capability-context");
      continue;
    }
    const property = member[1], remainder = after.slice(member[0].length);
    if (NAVIGATION_CAPABILITIES.has(property)) {
      if (!navigationCapabilityTailIsSupported(property, remainder, true)) findings.add("unsupported-global-capability-context");
    } else if (INDIRECT_GLOBAL_MEMBERS.has(property) || ["constructor", "prototype", "__proto__"].includes(property)) {
      findings.add("unsupported-global-capability-context");
    }
  }

  if (/(?:[A-Za-z_$][\w$]*|\)|\])\s*(?:\?\.|\.)\s*(?:defaultView|view|contentWindow|contentDocument|ownerDocument)\b/.test(masked)) {
    findings.add("indirect-global-source");
  }
  if (/\{[^{}\r\n]{0,1000}\[[^\]\r\n]+\]\s*:/.test(masked)) findings.add("computed-property-destructure");
  if (/\b(?:Reflect\s*\.\s*(?:get|set|apply|construct)|Object\s*\.\s*(?:assign|defineProperty|defineProperties|getOwnPropertyDescriptor|getOwnPropertyDescriptors|getPrototypeOf|setPrototypeOf)|__lookup(?:Getter|Setter)__)\s*\(/.test(masked)) {
    findings.add("dynamic-capability-reflection");
  }
  if (/\b(?:import|importScripts)\s*\(|\bnew\s+(?:Function|Worker|SharedWorker)\b|\bwith\s*\(/.test(masked)) {
    findings.add("dynamic-global-construction");
  }
}

function addIndirectNavigationCapabilityFindings(source, masked, findings) {
  const directRoots = {
    location: new Set(["window", "self", "globalThis", "document", "top", "parent"]),
    history: new Set(["window", "self", "globalThis"]),
    navigation: new Set(["window", "self", "globalThis"]),
  };
  for (const match of masked.matchAll(/([A-Za-z_$][\w$]*|\)|\])\s*(?:\?\.|\.)\s*(location|history|navigation)\b/g)) {
    const receiver = match[1], capability = match[2];
    const previous = previousNonWhitespace(masked, match.index);
    const directlyRewritable = directRoots[capability].has(receiver) && ![".", "]", ")"].includes(previous);
    if (!directlyRewritable) findings.add(`indirect-${capability}-object`);
  }

  for (const match of masked.matchAll(/([A-Za-z_$][\w$]*|\)|\])\s*(?:\?\.)?\s*\[([^\]\r\n]{0,300})\]/g)) {
    const open = match.index + match[0].indexOf("[");
    const close = match.index + match[0].lastIndexOf("]");
    const expression = source.slice(open + 1, close), staticProperty = staticJavaScriptString(expression);
    const decodedExpression = decodeIdentifierEscapes(expression);
    const tail = masked.slice(match.index + match[0].length, match.index + match[0].length + 180);
    const navigationTail = /^\s*(?:\?\.|\.)\s*(?:href|pathname|search|hash|protocol|host|hostname|port)\s*(?:\|\|=|&&=|\?\?=|\+=|-=|\*=|\/=|%=|=(?!=|>))|^\s*(?:\?\.|\.)\s*(?:assign|replace|reload|go|back|forward|navigate|traverseTo)\s*(?:\?\.)?\s*\(/.test(tail);
    if (["location", "history", "navigation"].includes(String(staticProperty || "").toLowerCase())
      || /(?:loc|ation|hist|navig)/i.test(decodedExpression) || navigationTail) {
      findings.add("computed-navigation-capability");
    }
  }

  for (const match of masked.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:[A-Za-z_$][\w$]*|\)|\])\s*(?:\?\.)?\s*\[[^\]\r\n]{0,300}\]/g)) {
    const alias = match[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const remainder = masked.slice(match.index + match[0].length);
    const capabilityUse = new RegExp(String.raw`\b${alias}\s*(?:\.|\?\.)\s*(?:(?:href|pathname|search|hash|protocol|host|hostname|port)\s*(?:\|\|=|&&=|\?\?=|\+=|-=|\*=|\/=|%=|=(?!=|>))|(?:assign|replace|reload|go|back|forward|navigate|traverseTo)\s*(?:\?\.)?\s*\()`).test(remainder);
    if (capabilityUse) findings.add("computed-navigation-capability-alias");
  }

  const destructuringPatterns = [
    /\b(?:const|let|var)\s*\{[^}\r\n]{0,600}\b(?:location|history|navigation)\b[^}\r\n]{0,600}\}\s*=/,
    /\bfunction\b[^\r\n(]{0,160}\([^)]{0,600}\{[^}]{0,500}\b(?:location|history|navigation)\b[^}]{0,500}\}[^)]{0,300}\)/,
    /\([^)]{0,600}\{[^}]{0,500}\b(?:location|history|navigation)\b[^}]{0,500}\}[^)]{0,300}\)\s*=>/,
    /\b[A-Za-z_$][\w$]*\s*\([^)]{0,600}\{[^}]{0,500}\b(?:location|history|navigation)\b[^}]{0,500}\}[^)]{0,300}\)\s*\{/,
    /\(\s*\{[^}]{0,500}\b(?:location|history|navigation)\b[^}]{0,500}\}\s*=/,
    /\b(?:const|let|var)\s*\{[^;=\r\n]{0,1000}\b(?:location|history|navigation)\b[^;=\r\n]{0,1000}\}\s*=/,
    /\(\s*\{[^;=\r\n]{0,1000}\b(?:location|history|navigation)\b[^;=\r\n]{0,1000}\}\s*=/,
  ];
  if (destructuringPatterns.some((pattern) => pattern.test(masked))) findings.add("navigation-capability-destructure");
  if (/\b(?:const|let|var)\s*\{[^}\r\n]{0,600}["'`](?:location|history|navigation)["'`][^}\r\n]{0,600}\}\s*=/.test(source)) {
    findings.add("navigation-capability-destructure");
  }
}

export function rewriteJavaScriptForViewer(value) {
  const source = String(value || ""), unsupported = unrewritableJavaScriptNavigationFindings(source);
  if (unsupported.length) {
    return `globalThis.__archiveViewerBlockNavigation(${JSON.stringify(`unsupported historical script: ${unsupported.join(", ")}`)});`;
  }
  const masked = maskJavaScriptNonCode(source), replacements = [];
  const collect = (pattern, replacement) => {
    for (const match of masked.matchAll(pattern)) replacements.push({ start: match.index, end: match.index + match[0].length, replacement });
  };
  const collectInertScriptCreations = (pattern, tagArgumentIndex = 0) => {
    for (const argumentsFound of callArguments(source, masked, pattern)) {
      const tagName = staticJavaScriptString(argumentsFound[tagArgumentIndex]);
      if (String(tagName || "").toLowerCase() !== "script") continue;
      replacements.push({
        start: argumentsFound.callStart,
        end: argumentsFound.callEnd,
        replacement: 'createElement("template")',
      });
    }
  };
  const globalLocation = String.raw`(?<![\w$?.])(?:(?:window|self|globalThis|document|top|parent)\s*(?:\.|\?\.)\s*)?location`;
  const globalHistory = String.raw`(?<![\w$?.])(?:(?:window|self|globalThis)\s*(?:\.|\?\.)\s*)?history`;
  const globalNavigation = String.raw`(?<![\w$?.])(?:(?:window|self|globalThis)\s*(?:\.|\?\.)\s*)?navigation`;
  const assignment = String.raw`(?:\|\|=|&&=|\?\?=|\+=|-=|\*=|\/=|%=|=(?!=|>))`;
  collect(new RegExp(String.raw`\b${globalLocation}\s*(?:\.|\?\.)\s*(?:assign|replace|reload)\s*(?:\?\.)?\s*\(`, "g"), "globalThis.__archiveViewerBlockNavigation(");
  collect(new RegExp(String.raw`\b${globalLocation}\s*(?:\.|\?\.)\s*(?:href|pathname|search|hash|protocol|host|hostname|port)\s*${assignment}`, "g"), "globalThis.__archiveViewerNavigationTarget =");
  collect(new RegExp(String.raw`\b(?:window|self|globalThis|document|top|parent)\s*(?:\.|\?\.)\s*location\s*${assignment}`, "g"), "globalThis.__archiveViewerNavigationTarget =");
  collect(new RegExp(String.raw`\b${globalHistory}\s*(?:\.|\?\.)\s*(?:go|back|forward)\s*(?:\?\.)?\s*\(`, "g"), "globalThis.__archiveViewerBlockNavigation(");
  collect(new RegExp(String.raw`\b${globalNavigation}\s*(?:\.|\?\.)\s*(?:navigate|back|forward|reload|traverseTo)\s*(?:\?\.)?\s*\(`, "g"), "globalThis.__archiveViewerBlockNavigation(");
  collectInertScriptCreations(/\bcreateElement\s*\(/g);
  collectInertScriptCreations(/\bcreateElementNS\s*\(/g, 1);
  replacements.sort((left, right) => left.start - right.start || right.end - left.end);
  let output = "", cursor = 0;
  for (const item of replacements) {
    if (item.start < cursor) continue;
    output += source.slice(cursor, item.start) + item.replacement;
    cursor = item.end;
  }
  return output + source.slice(cursor);
}

export function unrewritableJavaScriptNavigationFindings(value) {
  const source = String(value || ""), findings = new Set(), masked = maskJavaScriptNonCode(source, findings);
  const patterns = [
    ["computed-location-member", /(?:\b(?:window|self|globalThis|document|top|parent)\s*\[\s*["'`]location["'`]\s*\]|\blocation\s*\[\s*["'`](?:href|assign|replace|reload|pathname|search|hash|protocol|host|hostname|port)["'`]\s*\])/],
    ["location-alias", /\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(?:(?:window|self|globalThis|document|top|parent)\s*(?:\.|\?\.)\s*)?location\b(?!\s*(?:\.|\?\.|\[))/],
    ["location-destructure", /\b(?:const|let|var)\s*\{[^}]*\blocation\b[^}]*\}\s*=\s*(?:window|self|globalThis|document|top|parent)\b/],
    ["location-method-destructure", /\b(?:const|let|var)\s*\{[^}]*(?:\bassign\b|\breplace\b|\breload\b)[^}]*\}\s*=\s*(?:(?:window|self|globalThis|document|top|parent)\s*(?:\.|\?\.)\s*)?location\b/],
    ["location-method-destructure", /\(\s*\{[^}]*(?:\bassign\b|\breplace\b|\breload\b)[^}]*\}\s*=\s*(?:(?:window|self|globalThis|document|top|parent)\s*(?:\.|\?\.)\s*)?location\b/],
    ["location-method-indirection", /\blocation\s*(?:\.|\?\.)\s*(?:assign|replace|reload)\s*(?!(?:\?\.)?\s*\()/],
    ["history-method-indirection", /\bhistory\s*(?:\.|\?\.)\s*(?:go|back|forward)\s*(?!(?:\?\.)?\s*\()/],
    ["navigation-method-indirection", /\bnavigation\s*(?:\.|\?\.)\s*(?:navigate|back|forward|reload|traverseTo)\s*(?!(?:\?\.)?\s*\()/],
    ["navigation-object-alias", /\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(?:(?:window|self|globalThis)\s*(?:\.|\?\.)\s*)?(?:history|navigation)\b(?!\s*(?:\.|\?\.|\[))/],
    ["navigation-object-alias", /(?:^|[;{}\n])\s*[A-Za-z_$][\w$]*\s*=\s*(?:(?:window|self|globalThis)\s*(?:\.|\?\.)\s*)?(?:history|navigation)\b(?!\s*(?:\.|\?\.|\[))/m],
    ["navigation-method-destructure", /\b(?:const|let|var)\s*\{[^}]*(?:\bgo\b|\bback\b|\bforward\b|\bnavigate\b|\breload\b|\btraverseTo\b)[^}]*\}\s*=\s*(?:history|navigation)\b/],
    ["global-object-alias", /\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(?:window|self|globalThis|document|top|parent)\b(?!\s*(?:\.|\?\.|\[))/],
    ["global-object-alias", /(?:^|[;{}\n])\s*[A-Za-z_$][\w$]*\s*=\s*(?:window|self|globalThis|document|top|parent)\b(?!\s*(?:\.|\?\.|\[))/m],
    ["location-reflection", /\b(?:Reflect\s*\.\s*(?:get|set|apply)|Object\s*\.\s*(?:assign|defineProperty|getOwnPropertyDescriptor|getOwnPropertyDescriptors|getPrototypeOf)|__lookup(?:Getter|Setter)__)\s*\([^)]*\blocation\b/],
    ["location-reflection", /\b(?:Reflect\s*\.\s*(?:get|set)|Object\s*\.\s*(?:getOwnPropertyDescriptor|getOwnPropertyDescriptors))\s*\(\s*(?:window|self|globalThis|document|top|parent)\s*,/],
    ["location-prototype", /\b(?:Location\s*\.\s*prototype|location\s*\.\s*(?:constructor|__proto__))\b/],
    ["indirect-location-object", /\b(?:this|frames|defaultView)\s*(?:\.|\?\.)\s*location\b|\b(?:window|self|globalThis|document|top|parent)\s*(?:\.|\?\.)\s*(?:window|self|globalThis|document|top|parent)\s*(?:\.|\?\.)\s*location\b/],
    ["location-object-escape", /(?:\(|,|\[|\{|:|=|\breturn\s+|\byield\s+|=>)\s*(?:(?:window|self|globalThis|document|top|parent)\s*(?:\.|\?\.)\s*)?location\s*(?=,|\)|\]|}|;|$)/m],
    ["navigation-object-escape", /(?:\(|,|\[|\{|:|=|\breturn\s+|\byield\s+|=>)\s*(?:(?:window|self|globalThis)\s*(?:\.|\?\.)\s*)?(?:history|navigation)\s*(?=,|\)|\]|}|;|$)/m],
    ["location-alias-assignment", /(?:^|[;{}\n])\s*[A-Za-z_$][\w$]*\s*=\s*(?:(?:window|self|globalThis|document|top|parent)\s*(?:\.|\?\.)\s*)?location\b(?!\s*(?:\.|\?\.|\[))/m],
  ];
  for (const [name, pattern] of patterns) if (pattern.test(["computed-location-member", "location-reflection"].includes(name) ? source : masked)) findings.add(name);
  const decodedIdentifiers = decodeIdentifierEscapes(masked);
  if (decodedIdentifiers !== masked && /\b(?:location\s*(?:\.|\?\.|\[)|(?:history|navigation)\s*(?:\.|\?\.|\[))/.test(decodedIdentifiers)) {
    findings.add("escaped-navigation-identifier");
  }
  if (/\b(?:window|self|globalThis|document|top|parent)\s*\[[^\]\r\n]{0,200}(?:loc|ation)[^\]\r\n]{0,200}\]/i.test(source)) {
    findings.add("computed-location-member");
  }
  if (/\b(?:window|self|globalThis|document|top|parent)\s*(?:\?\.)?\s*\[/.test(masked)) {
    findings.add("computed-global-member");
  }
  for (const match of masked.matchAll(/\blocation\s*=(?!=|>)/g)) {
    const prefix = masked.slice(Math.max(0, match.index - 32), match.index);
    if (!/(?:\b(?:const|let|var)\s+|[.\w$])$/.test(prefix)) findings.add("bare-location-assignment");
  }
  addIndirectNavigationCapabilityFindings(source, masked, findings);
  addSupportedGlobalCapabilityFindings(source, masked, findings);
  addDynamicCodeConstructionFindings(source, masked, findings);
  return [...findings];
}
