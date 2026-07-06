# SyncifyPro — Shopify Export/Import App

## Stack
- React Router 7 (Shopify template), JS not TS
- Cloudflare R2 for file storage (signed URLs, 1hr expiry)
- Prisma + BullMQ (planned) for background jobs

## Architecture
Three-layer export: entities/ (fetch) → formats/ (CSV etc) → delivery/ (R2)
Three-layer import: parsers/ → validators/ → writers/
- exportJob.js auto-switches: <10k products = direct, >=10k = bulk operations
- Bulk: submit op → webhook (bulk_operations/finish) → worker streams JSONL → R2 multipart

## Key files
- export/exportJob.js, export/filters.js, export/delivery/r2.js
- workers/bulkOperationWorker.js
- routes/webhooks.bulk-operations.jsx

## Shopify gotchas hit
- variant.weight moved to inventoryItem.measurement.weight
- Order.financialStatus → displayFinancialStatus; LineItem keeps fulfillmentStatus
- Orders need read_orders + Protected Customer Data field approval
- R2 doesn't support object tagging; use native fetch to avoid SSL errors