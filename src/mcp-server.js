#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  CrawlbaseClient,
  CrawlbaseParametersSchema,
  StorageGetParametersSchema,
  StorageDeleteParametersSchema,
  StorageListParametersSchema,
  StorageCountParametersSchema,
  StorageBulkGetParametersSchema,
  StorageBulkDeleteParametersSchema,
} from './crawlbase/index.js';
import { MarkdownExtractor } from './utils/markdown.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { debug, isDebugEnabled, getDebugFilePath } from './utils/debug.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));

class CrawlbaseMCPServer {
  constructor(options = {}) {
    debug('=== CrawlbaseMCPServer Starting ===');
    debug('Environment:', {
      nodeVersion: process.version,
      platform: process.platform,
      cwd: process.cwd(),
    });

    this.server = new Server(
      { name: 'crawlbase-mcp-server', version: packageJson.version },
      { capabilities: { tools: {} } },
    );

    // Allow tokens from options (HTTP headers) or fall back to environment variables
    const normalToken = options.token || process.env.CRAWLBASE_TOKEN;
    const jsToken = options.jsToken || process.env.CRAWLBASE_JS_TOKEN;

    if (!normalToken && !jsToken) {
      debug(
        'Warning: No Crawlbase tokens provided. Please set CRAWLBASE_TOKEN and/or CRAWLBASE_JS_TOKEN environment variables, or pass tokens via HTTP headers.',
      );
    }

    this.client = new CrawlbaseClient(normalToken, jsToken);
    debug('CrawlbaseClient initialized with tokens:', {
      hasNormalToken: !!normalToken,
      hasJsToken: !!jsToken,
      tokenLengths: {
        normal: normalToken?.length || 0,
        js: jsToken?.length || 0,
      },
    });

    this.markdownExtractor = new MarkdownExtractor();
    this.setupHandlers();
    debug('Constructor completed');
  }

  setupHandlers() {
    debug('Setting up request handlers');

    this.server.setRequestHandler(ListToolsRequestSchema, () => {
      debug('Received ListTools request');
      const response = {
        tools: [
          {
            name: 'crawl',
            description:
              'Crawl a URL and return HTML content. Pass store=true to push the result to Crawlbase Cloud Storage instead of returning the body — the response will then contain only the RID and metadata, which can later be retrieved via storage_get.',
            inputSchema: {
              type: 'object',
              properties: {
                url: {
                  type: 'string',
                  description: 'The URL to crawl',
                },
                user_agent: {
                  type: 'string',
                  description: 'Custom user agent string',
                },
                device: {
                  type: 'string',
                  enum: ['desktop', 'mobile', 'tablet'],
                  description: 'Device type for crawling',
                },
                country: {
                  type: 'string',
                  description: 'Country code for geo-targeting',
                },
                ajax_wait: {
                  type: 'number',
                  description: 'Wait time for AJAX requests in milliseconds',
                },
                page_wait: {
                  type: 'number',
                  description: 'Wait time for page load in milliseconds',
                },
                screenshot: {
                  type: 'boolean',
                  description: 'Take a screenshot of the page',
                },
                store: {
                  type: 'boolean',
                  description:
                    'Push the result to Crawlbase Cloud Storage. When true, the response returns only RID + metadata (no body) so the body can be fetched later via storage_get.',
                },
              },
              required: ['url'],
            },
          },
          {
            name: 'crawl_markdown',
            description:
              'Crawl a URL and extract clean markdown content. Pass store=true to persist the original page in Cloud Storage and return only the RID + metadata.',
            inputSchema: {
              type: 'object',
              properties: {
                url: {
                  type: 'string',
                  description: 'The URL to crawl',
                },
                user_agent: {
                  type: 'string',
                  description: 'Custom user agent string',
                },
                device: {
                  type: 'string',
                  enum: ['desktop', 'mobile', 'tablet'],
                  description: 'Device type for crawling',
                },
                store: {
                  type: 'boolean',
                  description:
                    'Push the result to Crawlbase Cloud Storage. When true, returns only RID + metadata; retrieve later with storage_get (use as=markdown to convert).',
                },
              },
              required: ['url'],
            },
          },
          {
            name: 'crawl_screenshot',
            description:
              'Take a screenshot of a webpage. Pass store=true to persist the underlying HTML page to Cloud Storage (the screenshot itself is not stored and is still returned as an ephemeral screenshot_url).',
            inputSchema: {
              type: 'object',
              properties: {
                url: {
                  type: 'string',
                  description: 'The URL to screenshot',
                },
                device: {
                  type: 'string',
                  enum: ['desktop', 'mobile', 'tablet'],
                  description: 'Device type for screenshot',
                },
                page_wait: {
                  type: 'number',
                  description: 'Wait time before taking screenshot',
                },
                mode: {
                  type: 'string',
                  enum: ['fullpage', 'viewport'],
                  description: 'Screenshot mode (default: fullpage)',
                },
                width: {
                  type: 'number',
                  description: 'Maximum width in pixels (only with mode=viewport)',
                },
                height: {
                  type: 'number',
                  description: 'Maximum height in pixels (only with mode=viewport)',
                },
                store: {
                  type: 'boolean',
                  description:
                    'Persist the underlying HTML page to Cloud Storage. The screenshot itself is not stored; only RID + metadata + screenshot_url are returned (no image download). Storage is scoped to the JS token — use_js_token=true is required when retrieving it later.',
                },
              },
              required: ['url'],
            },
          },
          {
            name: 'storage_get',
            description:
              'Retrieve a single stored page from Crawlbase Cloud Storage by RID or URL. Only works for pages previously crawled with store=true. Returns the raw JSON record by default; pass as=html to return just the body, or as=markdown to convert it.',
            inputSchema: {
              type: 'object',
              properties: {
                rid: {
                  type: 'string',
                  description: 'Storage request ID. Either rid or url must be provided.',
                },
                url: {
                  type: 'string',
                  description: 'Original crawled URL. Either rid or url must be provided.',
                },
                as: {
                  type: 'string',
                  enum: ['json', 'html', 'markdown'],
                  description: 'How to render the body. Default: json (full record).',
                },
                use_js_token: {
                  type: 'boolean',
                  description:
                    "Query the JS token's storage instead of the normal token's. Storage is per-token. Set this to true if the prior crawl response showed token_type=js (i.e. screenshot or JS-rendered pages); otherwise the lookup will return 'Not found'.",
                },
              },
              required: [],
            },
          },
          {
            name: 'storage_delete',
            description: 'Delete a single item from Crawlbase Cloud Storage by RID.',
            inputSchema: {
              type: 'object',
              properties: {
                rid: {
                  type: 'string',
                  description: 'Storage request ID to delete.',
                },
                use_js_token: {
                  type: 'boolean',
                  description:
                    "Operate on the JS token's storage instead of the normal token's. Set to true if the target RIDs came from a crawl whose response showed token_type=js.",
                },
              },
              required: ['rid'],
            },
          },
          {
            name: 'storage_list',
            description:
              'List RIDs of pages previously crawled with store=true in Crawlbase Cloud Storage. Supports scroll-based pagination (scroll session expires after 15s of inactivity). Returns at most 1000 per call.',
            inputSchema: {
              type: 'object',
              properties: {
                limit: {
                  type: 'number',
                  description: 'Max RIDs to return (≤1000).',
                },
                scroll: {
                  type: 'boolean',
                  description: 'Enable scroll pagination.',
                },
                scroll_id: {
                  type: 'string',
                  description: 'Continuation token from a previous response.',
                },
                scroll_order: {
                  type: 'string',
                  enum: ['asc', 'desc'],
                  description: 'Sort direction (default desc).',
                },
                use_js_token: {
                  type: 'boolean',
                  description:
                    "Query the JS token's storage instead of the normal token's. Set to true if the prior crawl response showed token_type=js.",
                },
              },
              required: [],
            },
          },
          {
            name: 'storage_count',
            description: 'Get the total number of documents in Crawlbase Cloud Storage.',
            inputSchema: {
              type: 'object',
              properties: {
                use_js_token: {
                  type: 'boolean',
                  description:
                    "Query the JS token's storage instead of the normal token's. Set to true if the prior crawl response showed token_type=js.",
                },
              },
              required: [],
            },
          },
          {
            name: 'storage_bulk_get',
            description:
              'Bulk-fetch up to 100 stored items by RID. Bodies are decoded automatically. Default as=metadata_only returns just RID/URL/timestamps to keep context lean; use as=html or as=markdown to include bodies.',
            inputSchema: {
              type: 'object',
              properties: {
                rids: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Up to 100 storage RIDs to retrieve.',
                },
                auto_delete: {
                  type: 'boolean',
                  description: 'Delete each item from storage after it is retrieved.',
                },
                as: {
                  type: 'string',
                  enum: ['metadata_only', 'json', 'html', 'markdown'],
                  description:
                    'metadata_only (default) returns RID/URL/timestamps only; json returns full records; html/markdown include bodies.',
                },
                use_js_token: {
                  type: 'boolean',
                  description:
                    "Operate on the JS token's storage instead of the normal token's. Set to true if the target RIDs came from a crawl whose response showed token_type=js.",
                },
              },
              required: ['rids'],
            },
          },
          {
            name: 'storage_bulk_delete',
            description: 'Bulk-delete up to 100 items from Crawlbase Cloud Storage by RID. Irreversible.',
            inputSchema: {
              type: 'object',
              properties: {
                rids: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Up to 100 storage RIDs to delete.',
                },
                use_js_token: {
                  type: 'boolean',
                  description:
                    "Operate on the JS token's storage instead of the normal token's. Set to true if the target RIDs came from a crawl whose response showed token_type=js.",
                },
              },
              required: ['rids'],
            },
          },
        ],
      };
      debug('Returning tools list with', response.tools.length, 'tools');
      return response;
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      debug('Received CallTool request:', { tool: name, args });

      try {
        switch (name) {
          case 'crawl':
            return await this.handleCrawl(args);
          case 'crawl_markdown':
            return await this.handleCrawlMarkdown(args);
          case 'crawl_screenshot':
            return await this.handleCrawlScreenshot(args);
          case 'storage_get':
            return await this.handleStorageGet(args);
          case 'storage_delete':
            return await this.handleStorageDelete(args);
          case 'storage_list':
            return await this.handleStorageList(args);
          case 'storage_count':
            return await this.handleStorageCount(args);
          case 'storage_bulk_get':
            return await this.handleStorageBulkGet(args);
          case 'storage_bulk_delete':
            return await this.handleStorageBulkDelete(args);
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        debug('Error in CallTool handler:', error);
        return {
          content: [{ type: 'text', text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    });
  }

  async handleCrawl(args) {
    debug('handleCrawl called with:', args);
    const params = CrawlbaseParametersSchema.parse(args);
    debug('Parsed parameters:', params);

    const result = await this.client.crawl(params);
    debug('Crawl result:', {
      success: result.success,
      hasBody: !!result.data?.body,
      bodyLength: result.data?.body?.length,
      error: result.error,
    });
    if (result.success) {
      if (params.store) {
        return {
          content: [{ type: 'text', text: formatStoredMetadata(params.url, result.data) }],
        };
      }
      return {
        content: [
          {
            type: 'text',
            text: `Successfully crawled ${params.url}\n\nHTML Content:\n${result.data.body}`,
          },
        ],
      };
    } else {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to crawl ${params.url}: ${result.error.error}`,
          },
        ],
        isError: true,
      };
    }
  }

  async handleCrawlMarkdown(args) {
    const params = CrawlbaseParametersSchema.parse(args);
    const result = await this.client.crawl(params);
    if (result.success) {
      if (params.store) {
        return {
          content: [{ type: 'text', text: formatStoredMetadata(params.url, result.data) }],
        };
      }
      const markdown = this.markdownExtractor.extractMarkdown(result.data.body, params.url);

      // Limit content size to stay under token limits
      const maxLength = 50000; // Characters, not tokens, but safe estimate
      let content = markdown.content;

      if (content.length > maxLength) {
        content = content.substring(0, maxLength) + '\n\n[Content truncated due to size limits]';
      }

      return {
        content: [
          {
            type: 'text',
            text: `# ${markdown.title}\n\n${markdown.excerpt ? `**Summary:** ${markdown.excerpt}\n\n` : ''}${content}`,
          },
        ],
      };
    } else {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to crawl ${params.url}: ${result.error.error}`,
          },
        ],
        isError: true,
      };
    }
  }

  async handleCrawlScreenshot(args) {
    if (!this.client.jsToken) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to take screenshot: JavaScript token (CRAWLBASE_JS_TOKEN) is required for screenshots but not configured.`,
          },
        ],
        isError: true,
      };
    }

    // Force use of JS token for screenshots
    const params = CrawlbaseParametersSchema.parse({
      ...args,
      screenshot: true,
      token: this.client.jsToken,
    });
    debug('Screenshot request params:', params);

    const result = await this.client.crawl(params);
    debug('Screenshot crawl result:', {
      success: result.success,
      hasScreenshotUrl: !!result.data?.screenshot_url,
      screenshotUrl: result.data?.screenshot_url,
      error: result.error,
    });
    if (result.success) {
      if (params.store) {
        const lines = [formatStoredMetadata(params.url, result.data)];
        if (result.data.screenshot_url) {
          lines.push(`screenshot_url: ${result.data.screenshot_url}`);
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      }
      // Check if screenshot_url is provided in the response
      if (result.data.screenshot_url) {
        try {
          // Download the screenshot from the provided URL
          const screenshotResponse = await fetch(result.data.screenshot_url);
          if (screenshotResponse.ok) {
            const screenshotBuffer = await screenshotResponse.arrayBuffer();
            let imageBuffer = Buffer.from(screenshotBuffer);

            // Check image dimensions and resize if needed
            const MAX_DIMENSION = 8000;
            const metadata = await sharp(imageBuffer).metadata();

            if (metadata.width > MAX_DIMENSION || metadata.height > MAX_DIMENSION) {
              // Resize the image to fit within max dimensions while maintaining aspect ratio
              imageBuffer = await sharp(imageBuffer)
                .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
                .jpeg({ quality: 80 })
                .toBuffer();
            }

            const screenshotBase64 = imageBuffer.toString('base64');

            return {
              content: [
                { type: 'image', data: screenshotBase64, mimeType: 'image/jpeg' },
                {
                  type: 'text',
                  text: `Screenshot successfully taken of ${params.url}\n\nScreenshot URL: ${result.data.screenshot_url}`,
                },
              ],
            };
          } else {
            return {
              content: [
                {
                  type: 'text',
                  text: `Screenshot was generated for ${params.url}, but failed to download from URL: ${result.data.screenshot_url}. Status: ${screenshotResponse.status}`,
                },
              ],
              isError: true,
            };
          }
        } catch (error) {
          return {
            content: [
              {
                type: 'text',
                text: `Screenshot was generated for ${params.url}, but failed to download from URL: ${result.data.screenshot_url}. Error: ${error.message}`,
              },
            ],
            isError: true,
          };
        }
      } else {
        return {
          content: [
            {
              type: 'text',
              text: `Failed to take screenshot of ${params.url}: No screenshot URL returned. Please ensure you have a valid JavaScript token configured.`,
            },
          ],
          isError: true,
        };
      }
    } else {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to take screenshot of ${params.url}: ${result.error?.error || 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  async handleStorageGet(args) {
    const params = StorageGetParametersSchema.parse(args);
    const result = await this.client.storageGet({
      rid: params.rid,
      url: params.url,
      useJsToken: params.use_js_token,
    });
    if (!result.success) {
      return storageError('storage_get', result);
    }

    const data = result.data || {};
    const as = params.as || 'json';

    if (as === 'html') {
      return { content: [{ type: 'text', text: data.body || '' }] };
    }

    if (as === 'markdown') {
      const sourceUrl = data.url || params.url || '';
      const markdown = this.markdownExtractor.extractMarkdown(data.body || '', sourceUrl);
      let content = markdown.content;
      const maxLength = 50000;
      if (content.length > maxLength) {
        content = content.substring(0, maxLength) + '\n\n[Content truncated due to size limits]';
      }
      const header = markdown.title ? `# ${markdown.title}\n\n` : '';
      const summary = markdown.excerpt ? `**Summary:** ${markdown.excerpt}\n\n` : '';
      const meta = `_RID: ${data.rid || params.rid || ''} • stored_at: ${data.stored_at || ''}_\n\n`;
      return { content: [{ type: 'text', text: `${header}${meta}${summary}${content}` }] };
    }

    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }

  async handleStorageDelete(args) {
    const params = StorageDeleteParametersSchema.parse(args);
    const result = await this.client.storageDelete({
      rid: params.rid,
      useJsToken: params.use_js_token,
    });
    if (!result.success) {
      return storageError('storage_delete', result);
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }],
    };
  }

  async handleStorageList(args) {
    const params = StorageListParametersSchema.parse(args);
    const result = await this.client.storageList({
      limit: params.limit,
      scroll: params.scroll,
      scroll_id: params.scroll_id,
      scroll_order: params.scroll_order,
      useJsToken: params.use_js_token,
    });
    if (!result.success) {
      return storageError('storage_list', result);
    }
    const data = result.data || {};
    const rids = Array.isArray(data.rids) ? data.rids : [];
    const scrollId = data.scroll_id;
    const header = scrollId
      ? `Returned ${rids.length} RID(s). More available — pass scroll=true and scroll_id=${scrollId} to continue (session expires after 15s of inactivity).`
      : `Returned ${rids.length} RID(s). No more pages.`;
    return {
      content: [{ type: 'text', text: `${header}\n\n${JSON.stringify(data, null, 2)}` }],
    };
  }

  async handleStorageCount(args) {
    const params = StorageCountParametersSchema.parse(args || {});
    const result = await this.client.storageCount({ useJsToken: params.use_js_token });
    if (!result.success) {
      return storageError('storage_count', result);
    }
    let total;
    if (result.data && typeof result.data === 'object') {
      total = result.data.totalCount ?? result.data.total_count ?? result.data.total ?? result.data.count;
      if (total === undefined) total = JSON.stringify(result.data);
    } else {
      total = result.data;
    }
    return { content: [{ type: 'text', text: `Total: ${total}` }] };
  }

  async handleStorageBulkGet(args) {
    const params = StorageBulkGetParametersSchema.parse(args);
    const result = await this.client.storageBulkGet({
      rids: params.rids,
      auto_delete: params.auto_delete,
      useJsToken: params.use_js_token,
    });
    if (!result.success) {
      return storageError('storage_bulk_get', result);
    }

    const items = Array.isArray(result.data) ? result.data : [];
    const as = params.as || 'metadata_only';

    if (as === 'metadata_only') {
      const summary = items.map((item) => ({
        rid: item.rid,
        url: item.url,
        stored_at: item.stored_at,
        original_status: item.original_status,
        pc_status: item.pc_status,
        byte_length: typeof item.body === 'string' ? item.body.length : 0,
      }));
      return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
    }

    if (as === 'markdown') {
      const sections = items.map((item) => {
        const md = this.markdownExtractor.extractMarkdown(item.body || '', item.url || '');
        let content = md.content;
        const maxLength = 50000;
        if (content.length > maxLength) {
          content = content.substring(0, maxLength) + '\n\n[Content truncated due to size limits]';
        }
        const title = md.title || item.url || item.rid;
        return `## ${title}\n_RID: ${item.rid} • stored_at: ${item.stored_at}_\n\n${content}`;
      });
      return { content: [{ type: 'text', text: sections.join('\n\n---\n\n') }] };
    }

    if (as === 'html') {
      const sections = items.map((item) => `--- RID ${item.rid} (${item.url}) ---\n${item.body || ''}`);
      return { content: [{ type: 'text', text: sections.join('\n\n') }] };
    }

    return { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] };
  }

  async handleStorageBulkDelete(args) {
    const params = StorageBulkDeleteParametersSchema.parse(args);
    const result = await this.client.storageBulkDelete({
      rids: params.rids,
      useJsToken: params.use_js_token,
    });
    if (!result.success) {
      return storageError('storage_bulk_delete', result);
    }
    const items = Array.isArray(result.data) ? result.data : [];
    const total = items.length;
    const deleted = items.filter((i) => i && i.status === true).length;
    const notFound = items.filter((i) => i && i.result === 'Not Found');
    const failed = items.filter((i) => i && i.status === false && i.result !== 'Not Found');
    const lines = [`Deleted ${deleted}/${total}.`];
    if (notFound.length) {
      lines.push(`Not Found (${notFound.length}): ${notFound.map((i) => i.rid).join(', ')}`);
    }
    if (failed.length) {
      lines.push(`Failed (${failed.length}): ${failed.map((i) => i.rid).join(', ')}`);
    }
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }

  async run() {
    debug('Starting MCP server run()');
    const transport = new StdioServerTransport();
    debug('Created StdioServerTransport');

    await this.server.connect(transport);
    debug('Server connected and ready for requests');
  }
}

function formatStoredMetadata(url, data) {
  const lines = [`Stored ${url} in Crawlbase Cloud Storage`];
  if (data.rid) lines.push(`RID: ${data.rid}`);
  if (data.token_type) lines.push(`Token: ${data.token_type}`);
  if (data.stored_at) lines.push(`stored_at: ${data.stored_at}`);
  if (data.original_status !== undefined && data.original_status !== null) {
    lines.push(`original_status: ${data.original_status}`);
  }
  if (data.pc_status !== undefined && data.pc_status !== null) {
    lines.push(`pc_status: ${data.pc_status}`);
  }
  if (data.storage_url) lines.push(`storage_url: ${data.storage_url}`);
  if (!data.rid) {
    lines.push('');
    lines.push('Note: no RID returned by Crawlbase. Use storage_list to find the latest entry.');
  }
  return lines.join('\n');
}

function storageError(toolName, result) {
  const status = result.error && result.error.status;
  const msg = (result.error && result.error.error) || 'Unknown error';
  return {
    content: [{ type: 'text', text: `${toolName} failed (status ${status}): ${msg}` }],
    isError: true,
  };
}

export { CrawlbaseMCPServer };

// Auto-run only when executed directly (stdio mode)
const isDirectExecution =
  import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('crawlbase-mcp.js');

if (isDirectExecution) {
  if (isDebugEnabled()) {
    debug('=== Starting Crawlbase MCP Server ===');
    debug('Debug log location:', getDebugFilePath());
    debug('Debug mode enabled via DEBUG environment variable');
  }

  const server = new CrawlbaseMCPServer();
  server.run().catch((error) => {
    debug('Fatal error:', error);
    process.exit(1);
  });
}
