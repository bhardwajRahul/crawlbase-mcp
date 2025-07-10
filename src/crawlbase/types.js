import { z } from 'zod';

export const CrawlbaseParametersSchema = z.object({
  url: z.string().url(),
  token: z.string().optional(),
  user_agent: z.string().optional(),
  format: z.enum(['json', 'html']).optional(),
  device: z.enum(['desktop', 'mobile', 'tablet']).optional(),
  country: z.string().optional(),
  session: z.number().optional(),
  session_sticky_proxy: z.boolean().optional(),
  proxy_pool: z.enum(['datacenter', 'residential']).optional(),
  correlation_id: z.string().optional(),
  original_status: z.boolean().optional(),
  pc_status: z.boolean().optional(),
  get_cookies: z.boolean().optional(),
  custom_headers: z.record(z.string()).optional(),
  ajax_wait: z.number().optional(),
  page_wait: z.number().optional(),
  screenshot: z.boolean().optional(),
  screenshot_selector: z.string().optional(),
  mode: z.enum(['fullpage', 'viewport']).optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  pdf: z.boolean().optional(),
  autoparse: z.boolean().optional(),
  css_extractor: z.record(z.string()).optional(),
  scraper: z.string().optional(),
  webhook: z.string().optional(),
  get_headers: z.boolean().optional(),
  store: z.boolean().optional(),
  stored_data: z.string().optional(),
  scroll: z.boolean().optional(),
  scroll_interval: z.number().optional(),
  body: z.string().optional(),
  post_content_type: z.string().optional(),
});

export const CrawlbaseResponseSchema = z.object({
  body: z.string(),
  headers: z.record(z.string()).optional(),
  status: z.number(),
  url: z.string(),
  original_status: z.number().optional(),
  pc_status: z.number().optional(),
  cookies: z.record(z.string()).optional(),
  screenshot: z.string().optional(),
  pdf: z.string().optional(),
  stored_data: z.string().optional(),
});

/**
 * @typedef {object} CrawlbaseParameters
 * @property {string} url - The URL to crawl
 * @property {string} [token] - Authentication token
 * @property {string} [user_agent] - Custom user agent
 * @property {'json'|'html'} [format] - Response format
 * @property {'desktop'|'mobile'|'tablet'} [device] - Device type
 * @property {string} [country] - Country code
 * @property {number} [session] - Session ID
 * @property {boolean} [session_sticky_proxy] - Use sticky proxy
 * @property {'datacenter'|'residential'} [proxy_pool] - Proxy pool type
 * @property {string} [correlation_id] - Correlation ID
 * @property {boolean} [original_status] - Include original status
 * @property {boolean} [pc_status] - Include proxy chain status
 * @property {boolean} [get_cookies] - Return cookies
 * @property {object} [custom_headers] - Custom headers
 * @property {number} [ajax_wait] - AJAX wait time
 * @property {number} [page_wait] - Page wait time
 * @property {boolean} [screenshot] - Take screenshot
 * @property {string} [screenshot_selector] - Screenshot selector
 * @property {boolean} [pdf] - Generate PDF
 * @property {boolean} [autoparse] - Auto parse content
 * @property {object} [css_extractor] - CSS extractor config
 * @property {string} [scraper] - Scraper type
 * @property {string} [webhook] - Webhook URL
 * @property {boolean} [get_headers] - Return headers
 * @property {boolean} [store] - Store data
 * @property {string} [stored_data] - Stored data ID
 * @property {boolean} [scroll] - Scroll page
 * @property {number} [scroll_interval] - Scroll interval
 * @property {string} [body] - Request body
 * @property {string} [post_content_type] - POST content type
 */

/**
 * @typedef {object} CrawlbaseResponse
 * @property {string} body - Response body
 * @property {object} [headers] - Response headers
 * @property {number} status - HTTP status code
 * @property {string} url - Request URL
 * @property {number} [original_status] - Original status code
 * @property {number} [pc_status] - Proxy chain status code
 * @property {object} [cookies] - Response cookies
 * @property {string} [screenshot] - Screenshot data
 * @property {string} [pdf] - PDF data
 * @property {string} [stored_data] - Stored data
 */

/**
 * @typedef {object} CrawlbaseError
 * @property {string} error - Error message
 * @property {number} status - HTTP status code
 * @property {number} [pc_status] - Crawlbase proxy chain status
 * @property {number} [original_status] - Original website status
 */

/**
 * @typedef {object} CrawlResult
 * @property {boolean} success - Whether the request was successful
 * @property {CrawlbaseResponse} [data] - Response data
 * @property {CrawlbaseError} [error] - Error information
 * @property {string} [requestId] - Request ID
 * @property {number} [duration] - Request duration in ms
 */
