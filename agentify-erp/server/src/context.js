// Request-scoped tenant context. Every request (and every background job) runs inside one tenant's context, so
// db.js, util.js and the upload helpers pick that tenant's database, timezone and file folder without any route code
// having to pass the tenant around.
import { AsyncLocalStorage } from 'node:async_hooks';

export const als = new AsyncLocalStorage();

/** The current context: { tenant, db } or undefined outside a tenant (start-up, the single-tenant fallback). */
export const currentContext = () => als.getStore();
export const currentTenant = () => als.getStore()?.tenant || null;

/**
 * Re-enter the request's tenant context before calling `next`. Stream-driven middleware (multer, busboy) calls back
 * from the socket's async context, which drops AsyncLocalStorage; wrapping its `next` restores it.
 */
export function keepContext(next) {
  const store = als.getStore();
  return store ? (...args) => als.run(store, () => next(...args)) : next;
}
