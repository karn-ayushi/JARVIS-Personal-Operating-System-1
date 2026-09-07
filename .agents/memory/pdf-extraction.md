---
name: Node PDF extraction
description: The PDF extraction dependency choice for the JARVIS API and why it is loaded the way it is.
---

The JARVIS API uses the Node-compatible `pdfjs-dist/legacy/build/pdf.mjs` entry point dynamically inside the upload handler, then extracts page text with `getTextContent()`.

**Why:** The newer `pdf-parse` build eagerly loaded browser canvas globals at server startup, while the older package attempted to read a missing test fixture during import. Dynamic legacy PDF.js loading keeps the API process startable and avoids browser-only globals until a PDF is actually uploaded.

**How to apply:** Keep PDF.js out of top-level route-module initialization; preserve the dynamic import and page-by-page text extraction pattern when changing document ingestion.