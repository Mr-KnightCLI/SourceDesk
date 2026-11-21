# Retrieval evaluation

The fixture run used PostgreSQL with pgvector and deterministic six-dimensional embeddings returned by a local HTTP test provider. The corpus contained the two downloadable sample documents and 12 unrelated paragraphs. Expected locations are versioned in [test/cases.ts](test/cases.ts).

| Question | Expected source locations | Recall@8 |
| --- | --- | --- |
| How do the two plans differ on response time and support hours? | Standard support.pdf, Page 2 and Premium support.docx, Support commitments · Paragraph 2 | 2/2 |
| What is the cancellation notice for Standard? | Standard support.pdf, Page 3 | 1/1 |
| When can I reach the Premium support team? | Premium support.docx, Support commitments · Paragraph 2 | 1/1 |
| Do either of these plans include data residency guarantees? | Refusal | Passed |

**Fixture result:** 4/4 expected source locations found (100% Recall@8). No failed cases. The unsupported question is evaluated separately from recall.

**Live provider result:** Pending provider configuration. Run `npm run eval` to report the configured provider's retrieval results and any missed locations.
