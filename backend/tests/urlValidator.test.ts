import { test } from "node:test";
import assert from "node:assert/strict";
import { isSyntacticallyValidUrl, assertSafeMediaUrl } from "../src/utils/urlValidator.js";
import { FlowFetchError } from "../src/types/index.js";

test("rejects non-http(s) protocols", () => {
  assert.equal(isSyntacticallyValidUrl("ftp://example.com/file"), null);
  assert.equal(isSyntacticallyValidUrl("javascript:alert(1)"), null);
});

test("accepts well-formed http(s) urls", () => {
  assert.ok(isSyntacticallyValidUrl("https://example.com/watch?v=123"));
  assert.ok(isSyntacticallyValidUrl("http://example.com"));
});

test("rejects malformed input", () => {
  assert.equal(isSyntacticallyValidUrl("not a url"), null);
  assert.equal(isSyntacticallyValidUrl(""), null);
});

test("assertSafeMediaUrl rejects empty input", async () => {
  await assert.rejects(() => assertSafeMediaUrl(""), FlowFetchError);
});

test("assertSafeMediaUrl rejects loopback addresses", async () => {
  await assert.rejects(() => assertSafeMediaUrl("http://127.0.0.1/admin"), FlowFetchError);
});

test("assertSafeMediaUrl rejects link-local metadata address", async () => {
  await assert.rejects(() => assertSafeMediaUrl("http://169.254.169.254/latest/meta-data"), FlowFetchError);
});

test("assertSafeMediaUrl rejects localhost hostname", async () => {
  await assert.rejects(() => assertSafeMediaUrl("http://localhost:4000/secret"), FlowFetchError);
});
