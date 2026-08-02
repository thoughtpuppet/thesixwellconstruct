import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = readFileSync(join(ROOT, "js", "tattoo-specials.js"), "utf8");

test("Tattoo Specials loads in embedded browsers without crypto.randomUUID", async () => {
  const element = {
    addEventListener() {},
    querySelectorAll() { return []; },
    setCustomValidity() {},
    scrollIntoView() {},
    hidden: false,
    innerHTML: "",
    textContent: "",
    value: "",
  };
  const fetchCalls = [];
  const context = {
    crypto: {
      getRandomValues(bytes) {
        for (let index = 0; index < bytes.length; index += 1) bytes[index] = index;
        return bytes;
      },
    },
    document: {
      getElementById() { return element; },
      querySelectorAll() { return []; },
    },
    fetch(url) {
      fetchCalls.push(url);
      return Promise.resolve({
        ok: true,
        json: async () => ({ state: "closed", normalInquiryUrl: "/tattoos/inquire/" }),
      });
    },
    Intl,
    Date,
    Math,
    Promise,
    String,
    Number,
    Uint8Array,
    Array,
  };

  assert.doesNotThrow(() => vm.runInNewContext(script, context));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(fetchCalls, ["/api/tattoo/specials"]);
});
