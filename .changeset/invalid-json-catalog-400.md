---
"dsar": patch
---

Malformed JSON request bodies now return catalog code `REQUEST_BODY_INVALID_JSON` instead of `REQUEST_VALIDATION_FAILED`. Schema and field validation still use `REQUEST_VALIDATION_FAILED`.
