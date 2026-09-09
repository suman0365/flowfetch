import { test } from "node:test";
import assert from "node:assert/strict";
import { validateAnalyzeBody, validateDownloadBody, validateJobIdParam } from "../src/middleware/validation.js";
import { FlowFetchError } from "../src/types/index.js";

function fakeReq(body: any = {}, params: any = {}) {
  return { body, params } as any;
}

function runMiddleware(mw: (req: any, res: any, next: any) => void, req: any) {
  return new Promise<any>((resolve) => {
    mw(req, {} as any, (err?: any) => resolve(err));
  });
}

test("validateAnalyzeBody rejects missing url", async () => {
  const err = await runMiddleware(validateAnalyzeBody(), fakeReq({}));
  assert.ok(err instanceof FlowFetchError);
  assert.equal(err.code, "INVALID_URL");
});

test("validateAnalyzeBody accepts a url string", async () => {
  const err = await runMiddleware(validateAnalyzeBody(), fakeReq({ url: "https://example.com/x" }));
  assert.equal(err, undefined);
});

test("validateDownloadBody rejects missing formatId", async () => {
  const err = await runMiddleware(validateDownloadBody(), fakeReq({ url: "https://example.com/x" }));
  assert.ok(err instanceof FlowFetchError);
  assert.equal(err.code, "INVALID_FORMAT");
});

test("validateDownloadBody rejects formatId with shell metacharacters", async () => {
  const err = await runMiddleware(
    validateDownloadBody(),
    fakeReq({ url: "https://example.com/x", formatId: "137; rm -rf /" })
  );
  assert.ok(err instanceof FlowFetchError);
  assert.equal(err.code, "INVALID_FORMAT");
});

test("validateDownloadBody accepts a well-formed formatId", async () => {
  const err = await runMiddleware(
    validateDownloadBody(),
    fakeReq({ url: "https://example.com/x", formatId: "137+140" })
  );
  assert.equal(err, undefined);
});

test("validateJobIdParam rejects path-traversal-like ids", async () => {
  const err = await runMiddleware(validateJobIdParam(), fakeReq({}, { jobId: "../../etc/passwd" }));
  assert.ok(err instanceof FlowFetchError);
});

test("validateJobIdParam accepts a well-formed nanoid", async () => {
  const err = await runMiddleware(validateJobIdParam(), fakeReq({}, { jobId: "abcDEF123456" }));
  assert.equal(err, undefined);
});
