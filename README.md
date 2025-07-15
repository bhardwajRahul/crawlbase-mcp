# Crawlbase MCP Server

MCP server for [Crawlbase API](https://crawlbase.com) - enables web scraping through Model Context Protocol.

## Add to Your Editor

### Claude Code

Add to your `claude.json` configuration:

```json
{
  "mcpServers": {
    "crawlbase": {
      "type": "stdio",
      "command": "npx",
      "args": ["@crawlbase/mcp@latest"],
      "env": {
        "CRAWLBASE_TOKEN": "your_token_here",
        "CRAWLBASE_JS_TOKEN": "your_js_token_here"
      }
    }
  }
}
```

### Cursor

Add to `.cursor-settings.json`:

```json
{
  "mcpServers": {
    "crawlbase": {
      "type": "stdio",
      "command": "npx",
      "args": ["@crawlbase/mcp@latest"],
      "env": {
        "CRAWLBASE_TOKEN": "your_token_here",
        "CRAWLBASE_JS_TOKEN": "your_js_token_here"
      }
    }
  }
}
```

### Windsurf

Add to MCP settings:

```json
{
  "mcpServers": {
    "crawlbase": {
      "type": "stdio",
      "command": "npx",
      "args": ["@crawlbase/mcp@latest"],
      "env": {
        "CRAWLBASE_TOKEN": "your_token_here",
        "CRAWLBASE_JS_TOKEN": "your_js_token_here"
      }
    }
  }
}
```

## Usage

- `crawl` - Crawl a URL and return HTML
- `crawl_markdown` - Extract clean markdown from a URL
- `crawl_screenshot` - Take a screenshot of a webpage

## Get Your Token

Get your free Crawlbase token at [crawlbase.com](https://crawlbase.com)
