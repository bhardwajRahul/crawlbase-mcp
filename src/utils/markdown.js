import { parse } from 'node-html-parser';
import TurndownService from 'turndown';

/**
 * @typedef {object} MarkdownResult
 * @property {string} title - Document title
 * @property {string} content - Markdown content
 * @property {string} [excerpt] - Document excerpt
 * @property {string} url - Source URL
 * @property {number} length - Content length
 */

export class MarkdownExtractor {
  constructor() {
    this.turndownService = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      fence: '```',
      emDelimiter: '*',
      strongDelimiter: '**',
      linkStyle: 'inlined',
      linkReferenceStyle: 'full',
    });

    this.turndownService.addRule('removeScript', {
      filter: ['script', 'style', 'noscript'],
      replacement: () => '',
    });

    this.turndownService.addRule('preserveLinks', {
      filter: 'a',
      replacement: (content, node) => {
        const href = node.getAttribute('href');
        if (!href || href.startsWith('#')) {
          return content;
        }
        return `[${content}](${href})`;
      },
    });
  }

  extractMarkdown(html, url) {
    try {
      const root = parse(html);

      // Extract title
      const title = this.extractTitle(root);

      // Clean up the HTML for better markdown conversion
      const cleanedHTML = this.cleanContent(html);

      // Convert to markdown
      const markdown = this.turndownService.turndown(cleanedHTML);

      // Generate excerpt (first 200 chars)
      const excerpt = this.generateExcerpt(markdown);

      return {
        title: title || 'Untitled',
        content: markdown,
        excerpt,
        url,
        length: markdown.length,
      };
    } catch (error) {
      throw new Error(`Failed to extract markdown: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  extractTitle(root) {
    // Try <title> tag first
    const titleElement = root.querySelector('title');
    if (titleElement) {
      const title = titleElement.text.trim();
      if (title) return title;
    }

    // Try first <h1> tag
    const h1Element = root.querySelector('h1');
    if (h1Element) {
      const title = h1Element.text.trim();
      if (title) return title;
    }

    // Try meta title
    const metaTitle = root.querySelector('meta[property="og:title"]');
    if (metaTitle) {
      const title = metaTitle.getAttribute('content')?.trim();
      if (title) return title;
    }

    return null;
  }

  cleanContent(html) {
    // Parse the HTML again for manipulation
    const root = parse(html);

    // Remove unwanted elements (more aggressive for e-commerce sites)
    const unwantedSelectors = [
      'script',
      'style',
      'noscript',
      'nav',
      'header',
      'footer',
      'aside',
      '.navigation',
      '.sidebar',
      '.menu',
      '.ad',
      '.advertisement',
      '.reviews',
      '.review',
      '.comments',
      '.comment',
      '.related',
      '.recommendations',
      '.suggestions',
      '.carousel',
      '.slider',
      '.breadcrumb',
      '.pagination',
      '.social',
      '.share',
      '.newsletter',
      '.promo',
      '.banner',
      '#reviews',
      '#comments',
      '[class*="review"]',
      '[class*="comment"]',
      '[class*="related"]',
      '[class*="recommend"]',
      '[class*="suggestion"]',
      '[class*="carousel"]',
      '[class*="slider"]',
      '[class*="ad"]',
      '[class*="banner"]',
      '[class*="promo"]',
    ];

    unwantedSelectors.forEach((selector) => {
      const elements = root.querySelectorAll(selector);
      elements.forEach((el) => el.remove());
    });

    // Focus on main content areas (prioritize product info for e-commerce)
    const contentSelectors = [
      '#main-content',
      '#content',
      '.main-content',
      '.content',
      '.product-info',
      '.product-details',
      '.product-description',
      'main',
      'article',
      '.post',
      '.entry',
      '#main',
    ];

    let mainContent = null;
    for (const selector of contentSelectors) {
      mainContent = root.querySelector(selector);
      if (mainContent) break;
    }

    if (!mainContent) {
      // Fallback to body or entire document
      mainContent = root.querySelector('body') || root;
    }

    return mainContent.innerHTML || mainContent.toString();
  }

  generateExcerpt(markdown) {
    // Remove markdown syntax and get first 200 characters
    const plainText = markdown
      .replace(/#+\s+/g, '') // Remove headers
      .replace(/\*\*([^*]+)\*\*/g, '$1') // Remove bold
      .replace(/\*([^*]+)\*/g, '$1') // Remove italic
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Remove links, keep text
      .replace(/```[\s\S]*?```/g, '') // Remove code blocks
      .replace(/`([^`]+)`/g, '$1') // Remove inline code
      .trim();

    if (plainText.length <= 200) return plainText;

    // Find a good breaking point (end of sentence)
    const truncated = plainText.substring(0, 200);
    const lastSentence = truncated.lastIndexOf('.');

    if (lastSentence > 100) {
      return truncated.substring(0, lastSentence + 1);
    }

    return truncated + '...';
  }
}
