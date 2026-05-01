import assert from "node:assert/strict";
import test from "node:test";
import { normalizeHashRouteSearch } from "./hashRouteSearch";

test("normalizeHashRouteSearch merges hash query params with existing search params", () => {
  assert.equal(
    normalizeHashRouteSearch("https://example.test/?utm=campaign#/logs?level=info&source=worker"),
    "https://example.test/?utm=campaign&level=info&source=worker#/logs",
  );
});

test("normalizeHashRouteSearch lowercases hash query keys before matching", () => {
  assert.equal(
    normalizeHashRouteSearch("https://example.test/?level=warn#/logs?LEVEL=info"),
    "https://example.test/?level=info#/logs",
  );
});

test("normalizeHashRouteSearch leaves hashes without query params unchanged", () => {
  assert.equal(normalizeHashRouteSearch("https://example.test/#/logs"), null);
});
