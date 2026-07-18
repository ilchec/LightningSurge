const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Bridges the reactive lightning/graphql query wire (there's no imperative query executor - only
 * executeMutation) to a plain awaitable Promise. The host component points its @wire(graphql, ...)
 * config at whatever query this bridge is holding; when that wire's callback fires, it hands the
 * result to handleResult(), which settles the matching request.
 *
 * This only works correctly with one request in flight at a time - a strictly sequential access
 * pattern the host component must maintain (never call beginRequest() again before the previous
 * one's Promise has settled). Rather than silently misrouting a response to the wrong caller if
 * that's ever violated, beginRequest() rejects loudly. A timeout guards against a request that
 * never gets a response at all (e.g. the connection drops before the wire fires again), so a
 * caller's await can't hang forever.
 */
export class GraphqlQueryBridge {
  _pending;

  constructor(timeoutMs = DEFAULT_TIMEOUT_MS) {
    this._timeoutMs = timeoutMs;
  }

  /**
   * Starts a new request. Reassign the query the host's @wire is reactively bound to immediately
   * after calling this, so the wire actually re-fires.
   * @returns {Promise<object>} Resolves with the wire's `data`, rejects with an Error.
   */
  beginRequest() {
    if (this._pending) {
      return Promise.reject(new Error('A previous lookup query is still pending; queries must run one at a time.'));
    }
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this._pending = undefined;
        reject(new Error('Timed out waiting for a lookup query response.'));
      }, this._timeoutMs);
      this._pending = {
        resolve: (data) => {
          clearTimeout(timeoutId);
          this._pending = undefined;
          resolve(data);
        },
        reject: (error) => {
          clearTimeout(timeoutId);
          this._pending = undefined;
          reject(error);
        }
      };
    });
  }

  /**
   * Call from the host's @wire(graphql, ...) callback with its raw { data, errors } result.
   * No-ops if nothing is currently pending (e.g. the wire firing once on initial connection with
   * an undefined query, before beginRequest() has ever been called).
   */
  handleResult({ data, errors }) {
    if (!this._pending) return;
    if (data) {
      this._pending.resolve(data);
    } else if (errors) {
      this._pending.reject(new Error(errors[0]?.message || 'Unknown error running a lookup query'));
    }
  }
}
