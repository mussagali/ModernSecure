import assert from "node:assert/strict";
import { documentRequestState, latestDocumentVersion } from "../lib/document-request-state.ts";

const row = (version_no, status) => ({ version_no, status });
assert.equal(documentRequestState([]), "missing");
assert.equal(documentRequestState([row(1, "quarantine")]), "missing");
assert.equal(documentRequestState([row(1, "retracted")]), "missing");
assert.equal(documentRequestState([row(1, "accepted"), row(1, "accepted")]), "accepted");
assert.equal(documentRequestState([row(1, "accepted"), row(1, "under_review")]), "under_review");
assert.equal(documentRequestState([row(1, "accepted"), row(1, "returned")]), "returned");
assert.equal(documentRequestState([row(1, "accepted"), row(1, "retracted")]), "incomplete");
assert.equal(documentRequestState([row(1, "accepted"), row(2, "returned")]), "returned");
assert.equal(documentRequestState([row(1, "accepted"), row(2, "quarantine")]), "accepted");
assert.equal(documentRequestState([row(1, "accepted"), row(2, "retracted")]), "accepted");
assert.equal(latestDocumentVersion([row(1, "accepted"), row(2, "quarantine")]), 1);
console.log("OK document request state: latest submitted version, all pages, retraction and pending upload");
