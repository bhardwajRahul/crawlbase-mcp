import { CrawlbaseParametersSchema } from './types.js';
import { RetryQueue } from './retry-queue.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
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

        const crawlResponse = {
          body: responseText,
          status: response.status,
          url: validatedParams.url,
          original_status: originalStatusCode,
          pc_status: pcStatusCode,
        };

        // Check for screenshot URL in headers
        const screenshotUrl = response.headers.get('screenshot_url');

        if (screenshotUrl) {
          crawlResponse.screenshot_url = screenshotUrl;
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
}
