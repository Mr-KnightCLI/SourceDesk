# SourceDesk

A document research workspace built with Next.js, TypeScript, PostgreSQL, and pgvector. Upload files, ask questions across your library or a selection, and open inline citations to see the exact indexed excerpt and its location.

[Open SourceDesk on Vercel](https://sourcedesk-pearl.vercel.app)

## Run locally

Use Node.js 24 and either Docker with Compose or an existing PostgreSQL database with pgvector available.

1. Run `npm ci`.
2. Copy `.env.example` to `.env.local` and set `OPENAI_API_KEY`, or set `AI_PROVIDER=gemini` and `GEMINI_API_KEY` to use Google Gemini. Keep this file private. You can configure independent OpenAI-compatible chat and embedding endpoints, keys, and models using the variables in the example.
3. Run `docker compose up -d --wait` for local PostgreSQL. With an existing database, set `DATABASE_URL` and make sure the migration user can enable the `vector` extension.
4. Run `npm run migrate` to apply [001.sql](db/001.sql), then `npm run dev`.
5. Open [localhost:3000](http://localhost:3000). Set `APP_ORIGIN` to the exact public origin when deploying. Changing the embedding endpoint or model requires re-uploading and re-indexing documents.

The public sample workspace runs without PostgreSQL or an API key. It uses prewritten responses to three example questions. The private workspace uses PostgreSQL and calls the configured providers on the server.

## Deploy to Vercel

Import the GitHub repository into Vercel as a Next.js project using Node.js 24. The public sample workspace runs immediately. For private uploads and live answers, connect a hosted PostgreSQL database with pgvector, apply `db/001.sql` to that database, and set the production environment variables below in Vercel before redeploying.

| Variable | Production value |
| --- | --- |
| `DATABASE_URL` | Hosted PostgreSQL connection string. Use the pooled connection for the app when available. |
| `APP_ORIGIN` | Canonical HTTPS URL of the deployed app, without a trailing slash. |
| `AI_PROVIDER` | Set to `gemini` when using Gemini. |
| `GEMINI_API_KEY` or `OPENAI_API_KEY` | Server-side key for the selected provider. |

The Vercel upload limit is 4 MB per file, leaving room for multipart request overhead. Local installations accept up to 10 MB.

## 60-second walkthrough

| Time | Action |
| --- | --- |
| 0–15s | Open the sample workspace. The first answer compares Standard and Premium response times and support hours. |
| 15–30s | Click citations **1** and **2**. The preview opens the PDF on page 2 and the DOCX at **Support commitments · Paragraph 2**. |
| 30–45s | Select **Do either of these plans include data residency guarantees?** The workspace reports insufficient evidence. |
| 45–60s | Select **Standard support.pdf** in the document list and ask about its cancellation notice. Open the citation to find the notice on page 3. |

To demonstrate live generation, create a private workspace, click **Add sample documents**, wait for both files to reach **Indexed**, and run the same questions. You can also download the PDF and DOCX from the sample source panel and upload them yourself.

## How it works

- PDF text is extracted one page at a time. DOCX tracks Word heading styles and paragraph numbers, Markdown tracks headings and line numbers, and TXT tracks paragraphs. Scanned PDFs require OCR. Files are limited to 10 MB, PDFs to 300 pages, and each document to 900 chunks.
- SourceDesk stores originals for retries and publishes the chunks and indexed status in one database statement. Deletion cascades to all chunks. Failed or interrupted runs can be retried from the document list. An interrupted indexing attempt becomes eligible for takeover after 20 minutes.
- Retrieval ranks eligible chunks with pgvector cosine distance and applies a small per-document ranking penalty to diversify the top eight. Only the user's question and those excerpts with source labels are sent to the chat provider. The system prompt explicitly treats document text as untrusted. The server validates citation IDs and resolves previews through an owner-scoped lookup. ID validation checks provenance, while users can inspect the exact excerpt to assess the claim.
- The private workspace uses scrypt password hashes and opaque, expiring sessions in HTTP-only cookies. Every document, retrieval, and preview query is scoped to the session's account. Use HTTPS and request rate limits for a public deployment. Queries and extracted text are sent to the configured providers during indexing and Q&A.

## Verification

`npm test` runs ingestion, retry, scoped retrieval, answer and citation validation, deletion, and cross-user checks against embedded PostgreSQL with real pgvector and a deterministic local HTTP provider double. It also exercises the Next.js API handlers with two authenticated sessions. `npm run build` checks the production bundle and TypeScript.

`npm run eval` uses the configured PostgreSQL database and providers. It creates a temporary private account, indexes both sample files, reports Recall@8 and each missed source location, tests the refusal, then removes the temporary account and documents.

See [EVALUATION.md](EVALUATION.md) for the fixture result and expected locations. The evaluation includes 12 unrelated paragraphs alongside the two sample files. The fixture score checks the retrieval and citation pipeline with deterministic embeddings. Use the live evaluation to measure your configured embedding model on the same cases.
