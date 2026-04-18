# Edgar Normalizer MCP

An MCP tool server that extracts normalized, typed, multi-period XBRL financial facts from SEC EDGAR for a single company or a basket of up to 20 tickers.

## Features

- Extract financial data from SEC EDGAR using XBRL
- Normalize and structure financial facts
- Support for single ticker and basket queries (up to 20 tickers)
- Concept alias resolution for natural language queries
- Health check endpoint
- Dockerized for easy deployment

## Scope

In scope:

- Top ~50 common financial line items (revenue, net income, assets, etc.) via static alias map
- 10-K/10-Q filings, US domestic EDGAR filers, post-2009 XBRL era
- Segment dimensions if tagged in XBRL

Not covered:

- Arbitrary/obscure XBRL concepts outside the ~50 aliases
- IFRS filers or foreign private issuers
- Pre-2009 non-XBRL filings
- Derived metrics (FCF, EBITDA, ratios)
- PDF/HTML extraction (inline XBRL only via the EDGAR REST API)
- Notes disclosures, footnotes, or non-numeric XBRL facts

## Quick Start with Docker

1. Build the Docker image:

   ```bash
   docker build -t edgar-normalizer .
   ```

2. Run the container (replace `your_key` with your actual Inception API key):

   ```bash
   docker run -p 3001:3001 -e INCEPTION_API_KEY=your_key edgar-normalizer
   ```

3. The server will be available at `http://localhost:3001`

## Local Development

1. Install dependencies:

   ```bash
   bun install
   ```

2. Set up environment variables (copy `.env.example` to `.env` and fill in your values):

   ```bash
   cp .env.example .env
   ```

3. Start the development server:
   ```bash
   PORT=3001 INCEPTION_API_KEY=your_key bun run dev
   ```

## Available Commands

- `bun run dev` - Start development server with hot reload
- `bun run start` - Start production server
- `bun run query "AAPL" quick` - Test a tool via CLI
- `bun run typecheck` - Run TypeScript type checking
- `bun run compile` - Build production binary
- `curl http://localhost:3001/health` - Health check

## Environment Variables

- `INCEPTION_API_KEY` (required) - API key for Mercury 2 LLM synthesis
- `PORT` (optional, defaults to 3001) - Port to run the server on

## Project Structure

```
src/
  index.ts          # Express + MCP server setup
  types.ts          # TypeScript interfaces
  cli.ts            # Dev CLI for local tool testing
  tools/
    index.ts        # Tool registry
    get-facts.ts          # get_facts tool
    get-facts-basket.ts   # get_facts_basket tool
    resolve-concept.ts    # resolve_concept tool
    get-filing-metadata.ts
    get-segment-facts.ts
  lib/
    orchestrator.ts       # EDGAR fetch + normalization pipeline
  data/
    edgar.ts              # companyfacts + submissions API calls
    concept-aliases.ts    # Static map: natural language → ordered XBRL concept URIs
  synthesis/
    mercury.ts            # Mercury 2 structured JSON output
```

## Health Check

The service provides a health check endpoint at `GET /health` which returns:

```json
{ "status": "ok", ... }
```

## License

This project is proprietary and part of the CTX marketplace.
