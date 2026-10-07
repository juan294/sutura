# Nebius Data Lab: upload and batch attempt, 2026-10-07

Subject: the reviewed 110-row public-safe dataset prepared from the committed v0.2
Placebo result (request hash `b8f2e4dcbf6aecfb3ba17302eda14fa52c1ebd8bee17e721cb5d22e8089713c2`,
input hash `ca456eb2516a33bcf5e8db16e0ce81859ab67219b5a52751ceb26ed0cb3daeaa`).
Authorization: Juan approved Gate A (upload) and Gate B (one batch, cap USD 0.05) in chat
on 2026-10-07, and approved the first command through `/permissions`.

## Result

| Step | Outcome |
| --- | --- |
| Gate A: upload | Succeeded on the third attempt. Dataset `845ad10fcb874eec9d50255e8c5b0149`, version `fdf17ab486e0411b85705057b7605d06`, status READY, 110 rows. Record: [`sutura-placebo-v0.2-live-experiment-record-v1.json`](../datalab/sutura-placebo-v0.2-live-experiment-record-v1.json). |
| Source read-back | `GET /v1/datasets/{id}` and `/content` answered 200 for the uploaded dataset. |
| Gate B: batch dispatch | Rejected: `POST /v1/operations` returned HTTP 403 `{"detail":"You don't have access to the resource or it does not exist"}`. `GET /v1/operations` lists no operation, so nothing was dispatched and nothing was spent. |

Spend: USD 0. The upload has no inference cost, and the batch never started.

## What the first two upload attempts showed

1. HTTP 400 with no detail. Sutura's client dropped the response body. After the client
   was changed to include it (commit "include the provider error body in Data Lab request
   failures"), the second attempt returned
   `{"detail":"Error validating column \"inferenceCostUsd\""}`.
2. The column is declared `double`. 32 of the 110 rows hold the value `0`, which
   `JSON.stringify` writes as the integer `0`; the other 78 hold fractions. The third
   attempt wrote whole numbers in double columns as `0.0` (commit "write whole numbers in
   Data Lab double columns with a decimal point") and the upload succeeded. We did not
   test other variants, so the integer-in-double-column explanation is the one consistent
   with the evidence, not an isolated proof. The message names the column but not the row.

The dataset content and both hashes were unchanged by the fix; only the wire format of
whole numbers differs.

## Open items

- The batch needs access we have not identified. The request matches the published
  OpenAPI schema for `batch_inference` (type, params with model and completion window,
  source dataset with a `text_messages` mapping, empty `dst`). The 403 does not say whether
  the key lacks Data Lab batch permission, the model is unavailable for batch, or the
  resource is hidden. This is recorded in the
  [feedback document](../feedback/2026-10-sutura-nebius-feedback.md).
- The uploaded dataset remains in Data Lab until deleted. The
  [data-boundaries guide](../security/data-boundaries.md) asks the owner to delete datasets
  and outputs when the experiment ends.
