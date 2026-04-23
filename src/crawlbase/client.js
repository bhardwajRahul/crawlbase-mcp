import { CrawlbaseParametersSchema } from './types.js';
import { RetryQueue } from './retry-queue.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { gunzipSync } from 'zlib';
import { debug } from '../utils/debug.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'));

/**
 * Crawlbase API client
 */
export class CrawlbaseClient {
  /**
   * @param {string} [normalToken] - Normal token for basic requests
   * @param {string} [jsToken] - JavaScript token for JS-rendered pages
   */
  constructor(normalToken, jsToken) {
    this.baseUrl = 'https://api.crawlbase.com';
    this.normalToken = normalToken;
    this.jsToken = jsToken;
    this.retryQueue = new RetryQueue();

    debug('CrawlbaseClient initialized', {
      hasNormalToken: !!normalToken,
      hasJsToken: !!jsToken,
      baseUrl: this.baseUrl,
    });
  }

  /**
   * Check if JS token is needed for this request
   * @param {CrawlbaseParameters} params - Request parameters
   * @returns {boolean}
   */
  needsJSToken(params) {
    return !!(
      params.device ||
      params.ajax_wait ||
      params.page_wait ||
      params.scroll ||
      params.screenshot ||
      params.pdf
    );
  }

  /**
   * Get the appropriate token for the request
   * @param {CrawlbaseParameters} params - Request parameters
   * @returns {string}
   */
  getToken(params) {
    const needsJS = this.needsJSToken(params);
    debug('Token selection:', {
      needsJSToken: needsJS,
      hasJsToken: !!this.jsToken,
      hasNormalToken: !!this.normalToken,
    });

    if (needsJS) {
      if (!this.jsToken) {
        throw new Error('JavaScript token required for this request but not provided');
      }
      return this.jsToken;
    }

    if (!this.normalToken) {
      throw new Error('Normal token required but not provided');
    }

    return this.normalToken;
  }

  /**
   * Build URL search parameters for the request
   * @param {CrawlbaseParameters} params - Request parameters
   * @returns {URLSearchParams}
   */
  buildRequestParams(params) {
    const token = params.token || this.getToken(params);
    const searchParams = new URLSearchParams();

    searchParams.append('token', token);
    searchParams.append('url', params.url);

    Object.entries(params).forEach(([key, value]) => {
      if (key !== 'token' && key !== 'url' && value !== undefined) {
        if (typeof value === 'object') {
          searchParams.append(key, JSON.stringify(value));
        } else {
          searchParams.append(key, String(value));
        }
      }
    });

    return searchParams;
  }

  /**
   * Crawl a URL using the Crawlbase API
   * @param {CrawlbaseParameters} params - Request parameters
   * @returns {Promise<CrawlResult>}
   */
  async crawl(params) {
    // Validate parameters
    const validatedParams = CrawlbaseParametersSchema.parse(params);
    const startTime = Date.now();
    const requestId = Math.random().toString(36).substring(7);

    debug('Starting crawl request:', {
      requestId,
      url: validatedParams.url,
      hasScreenshot: validatedParams.screenshot,
      device: validatedParams.device,
    });

    try {
      const result = await this.retryQueue.add(async () => {
        const searchParams = this.buildRequestParams(validatedParams);
        const fetchUrl = `${this.baseUrl}?${searchParams.toString()}`;
        debug('Making API request:', { requestId, method: 'GET', urlLength: fetchUrl.length });

        const response = await fetch(fetchUrl, {
          method: 'GET',
          headers: {
            'User-Agent': `${packageJson.name}/${packageJson.version}`,
            'Accept-Encoding': 'gzip, deflate',
          },
        });

        const responseText = await response.text();
        const duration = Date.now() - startTime;

        debug('API response received:', {
          requestId,
          status: response.status,
          duration,
          responseLength: responseText.length,
          headers: Object.fromEntries(response.headers.entries()),
        });

        // Check for HTTP errors from Crawlbase API itself
        if (response.status >= 400) {
          const error = {
            error: responseText || 'Request failed',
            status: response.status,
          };

          return {
            success: false,
            error,
            requestId,
            duration,
          };
        }

        // Get Crawlbase-specific status codes
        const pcStatus = response.headers.get('pc_status');
        const originalStatus = response.headers.get('original_status');

        // Check if this is a chargeable/successful request
        // Crawlbase charges for: 200, 201, 204, 301, 302, 404, 410 with pc_status 200
        const chargeableStatuses = [200, 201, 204, 301, 302, 404, 410];
        const originalStatusCode = originalStatus ? parseInt(originalStatus, 10) : null;
        const pcStatusCode = pcStatus ? parseInt(pcStatus, 10) : null;

        // If pc_status is not 200 or original_status is not chargeable, treat as retry-able failure
        if (pcStatusCode !== 200 || (originalStatusCode && !chargeableStatuses.includes(originalStatusCode))) {
          const error = {
            error: `Non-chargeable response: pc_status=${pcStatusCode}, original_status=${originalStatusCode}`,
            status: response.status,
            pc_status: pcStatusCode,
            original_status: originalStatusCode,
          };

          return {
            success: false,
            error,
            requestId,
            duration,
          };
        }

        const tokenUsed = validatedParams.token || this.getToken(validatedParams);
        const tokenType = this.jsToken && tokenUsed === this.jsToken ? 'js' : 'normal';

        const crawlResponse = {
          body: responseText,
          status: response.status,
          url: validatedParams.url,
          original_status: originalStatusCode,
          pc_status: pcStatusCode,
          token_type: tokenType,
        };

        // Check for screenshot URL in headers
        const screenshotUrl = response.headers.get('screenshot_url');

        if (screenshotUrl) {
          crawlResponse.screenshot_url = screenshotUrl;
        }

        // Storage metadata when store=true was passed on the crawl request
        const ridHeader = response.headers.get('rid');
        if (ridHeader) {
          crawlResponse.rid = ridHeader;
        }
        const storedAtHeader = response.headers.get('stored_at');
        if (storedAtHeader) {
          crawlResponse.stored_at = storedAtHeader;
        }
        const storageUrlHeader = response.headers.get('storage_url');
        if (storageUrlHeader) {
          crawlResponse.storage_url = storageUrlHeader;
        }

        // Debug: Log all headers if screenshot was requested but no URL found
        if (validatedParams.screenshot && !screenshotUrl) {
          debug('WARNING: Screenshot requested but no URL in headers', {
            requestId,
            headers: Object.fromEntries(response.headers.entries()),
            requestParams: {
              url: validatedParams.url,
              screenshot: validatedParams.screenshot,
              token: validatedParams.token ? `${validatedParams.token.substring(0, 4)}...` : 'token not in params',
            },
          });
        }

        const setCookieHeader = response.headers.get('set-cookie');
        if (setCookieHeader) {
          const cookies = {};
          const cookieArray = setCookieHeader.split(', ');

          cookieArray.forEach((cookie) => {
            const [nameValue] = cookie.split(';');
            const [name, value] = nameValue.split('=');
            if (name && value) cookies[name.trim()] = value.trim();
          });

          crawlResponse.cookies = cookies;
        }

        return {
          success: true,
          data: crawlResponse,
          requestId,
          duration,
        };
      });

      debug('Crawl completed:', { requestId, success: result.success });
      return result;
    } catch (error) {
      debug('Crawl error:', { requestId, error: error.message });
      return {
        success: false,
        error: {
          error: error instanceof Error ? error.message : 'Unknown error',
          status: 500,
        },
        requestId,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Pick which token to use for a storage operation. Storage is per-token, so
   * the caller must pick the same token that was used to crawl with store=true.
   * @param {boolean} [useJsToken] - Prefer the JS token
   * @returns {{ token: string, type: 'normal'|'js' }}
   */
  pickStorageToken(useJsToken) {
    if (useJsToken) {
      if (this.jsToken) return { token: this.jsToken, type: 'js' };
      // Do NOT silently fall back to the normal token: storage is per-token, so
      // querying the wrong one would return "not found" and confuse the caller.
      throw new Error('JS token requested for storage but CRAWLBASE_JS_TOKEN is not configured');
    }
    if (this.normalToken) return { token: this.normalToken, type: 'normal' };
    if (this.jsToken) return { token: this.jsToken, type: 'js' };
    throw new Error('No Crawlbase token configured for storage');
  }

  /**
   * Internal helper for all storage HTTP calls. Returns the same shape as crawl():
   * { success, data, error, requestId, duration }.
   * @param {object} opts
   * @param {'GET'|'POST'|'DELETE'} opts.method
   * @param {string} opts.path - Path under baseUrl, e.g. '/storage'
   * @param {Record<string, string|number|boolean>} [opts.params] - Query params (token added automatically)
   * @param {object} [opts.body] - JSON body for POST
   * @param {boolean} [opts.useJsToken]
   * @returns {Promise<object>}
   */
  async _storageRequest({ method, path, params, body, useJsToken }) {
    const { token, type } = this.pickStorageToken(useJsToken);
    const startTime = Date.now();
    const requestId = Math.random().toString(36).substring(7);

    debug('Storage request:', { requestId, method, path, tokenType: type });

    try {
      return await this.retryQueue.add(async () => {
        const searchParams = new URLSearchParams();
        searchParams.append('token', token);
        Object.entries(params || {}).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            searchParams.append(key, String(value));
          }
        });

        const fetchUrl = `${this.baseUrl}${path}?${searchParams.toString()}`;
        const init = {
          method,
          headers: {
            'User-Agent': `${packageJson.name}/${packageJson.version}`,
          },
        };
        if (body !== undefined) {
          init.headers['Content-Type'] = 'application/json';
          init.body = JSON.stringify(body);
        }

        const response = await fetch(fetchUrl, init);
        const responseText = await response.text();
        const duration = Date.now() - startTime;

        debug('Storage response:', {
          requestId,
          status: response.status,
          duration,
          length: responseText.length,
        });

        if (response.status === 404) {
          return {
            success: false,
            error: { error: 'Not found in storage', status: 404 },
            tokenType: type,
            requestId,
            duration,
          };
        }

        if (response.status >= 400) {
          return {
            success: false,
            error: {
              error: responseText || 'Storage request failed',
              status: response.status,
            },
            tokenType: type,
            requestId,
            duration,
          };
        }

        let data;
        try {
          data = responseText ? JSON.parse(responseText) : null;
        } catch {
          data = responseText;
        }

        return { success: true, data, tokenType: type, requestId, duration };
      });
    } catch (error) {
      debug('Storage error:', { requestId, error: error.message });
      return {
        success: false,
        error: {
          error: error instanceof Error ? error.message : 'Unknown error',
          status: 500,
        },
        tokenType: type,
        requestId,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Retrieve a single stored page by RID or URL.
   * @param {{ rid?: string, url?: string, useJsToken?: boolean }} opts
   * @returns {Promise<object>}
   */
  async storageGet({ rid, url, useJsToken }) {
    return this._storageRequest({
      method: 'GET',
      path: '/storage',
      params: { format: 'json', ...(rid ? { rid } : {}), ...(url ? { url } : {}) },
      useJsToken,
    });
  }

  /**
   * Delete a single stored item by RID.
   * @param {{ rid: string, useJsToken?: boolean }} opts
   * @returns {Promise<object>}
   */
  async storageDelete({ rid, useJsToken }) {
    const result = await this._storageRequest({
      method: 'DELETE',
      path: '/storage',
      params: { rid },
      useJsToken,
    });
    // Crawlbase returns HTTP 200 with `{ error: '...' }` (e.g. when the rid
    // does not exist). Surface that as a failure so callers don't treat
    // "nothing was deleted" as success.
    if (result.success && result.data && typeof result.data === 'object' && result.data.error) {
      return {
        ...result,
        success: false,
        data: undefined,
        error: { error: String(result.data.error), status: 200 },
      };
    }
    return result;
  }

  /**
   * List RIDs in storage (paginated via scroll).
   * @param {{ limit?: number, scroll?: boolean, scroll_id?: string, scroll_order?: 'asc'|'desc', useJsToken?: boolean }} opts
   * @returns {Promise<object>}
   */
  async storageList({ limit, scroll, scroll_id, scroll_order, useJsToken }) {
    return this._storageRequest({
      method: 'GET',
      path: '/storage/rids',
      params: {
        ...(limit !== undefined ? { limit } : {}),
        // Only forward `scroll` when explicitly enabled — Crawlbase treats the
        // mere presence of the param as opting in to scroll mode.
        ...(scroll ? { scroll: true } : {}),
        ...(scroll_id ? { scroll_id } : {}),
        ...(scroll_order ? { scroll_order } : {}),
      },
      useJsToken,
    });
  }

  /**
   * Total number of documents in storage.
   * @param {{ useJsToken?: boolean }} [opts]
   * @returns {Promise<object>}
   */
  async storageCount({ useJsToken } = {}) {
    return this._storageRequest({
      method: 'GET',
      path: '/storage/total_count',
      useJsToken,
    });
  }

  /**
   * Bulk fetch up to 100 stored items. Decodes each item's body
   * (base64 + gzip per Crawlbase docs) into plain HTML.
   * @param {{ rids: string[], auto_delete?: boolean, useJsToken?: boolean }} opts
   * @returns {Promise<object>}
   */
  async storageBulkGet({ rids, auto_delete, useJsToken }) {
    const result = await this._storageRequest({
      method: 'POST',
      path: '/storage/bulk',
      body: { rids, ...(auto_delete !== undefined ? { auto_delete } : {}) },
      useJsToken,
    });

    if (result.success && Array.isArray(result.data)) {
      result.data = result.data.map((item) => {
        if (item && typeof item.body === 'string' && item.body.length > 0) {
          try {
            item.body = gunzipSync(Buffer.from(item.body, 'base64')).toString('utf8');
          } catch (err) {
            debug('Failed to decode bulk item body:', { rid: item.rid, error: err.message });
          }
        }
        return item;
      });
    }

    return result;
  }

  /**
   * Bulk delete up to 100 stored items by RID.
   * @param {{ rids: string[], useJsToken?: boolean }} opts
   * @returns {Promise<object>}
   */
  async storageBulkDelete({ rids, useJsToken }) {
    return this._storageRequest({
      method: 'POST',
      path: '/storage/bulk_delete',
      body: { rids },
      useJsToken,
    });
  }
}
