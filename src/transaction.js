// src/transaction.js
// Generates fresh x-client-transaction-id header values for X's GraphQL API.
//
// X validates this header per-request against a signing key embedded in the
// x.com/home page HTML, so a value copied once (e.g. into .env) goes stale
// almost immediately. This computes it locally, once per process, using the
// `x-client-transaction-id` package (reverse-engineered, network calls only
// to x.com's own endpoints).
import { ClientTransaction, fetchXDocument } from 'x-client-transaction-id';

export async function createTransactionIdGenerator() {
  const document = await fetchXDocument();
  const transaction = await ClientTransaction.create(document);
  return (method, path) => transaction.generateTransactionId(method, path);
}
