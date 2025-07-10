import PQueue from 'p-queue';
import { debug } from '../utils/debug.js';

/**
 * Retry queue for handling failed requests with exponential backoff
 */
export class RetryQueue {
  /**
   * Initialize the retry queue
   */
  constructor() {
    this.queue = new PQueue({
      concurrency: 20,
      interval: 1000,
      intervalCap: 20,
    });
    this.maxRetries = 3;
    this.baseDelay = 1000;

    debug('RetryQueue initialized:', {
      concurrency: 20,
      maxRetries: this.maxRetries,
      baseDelay: this.baseDelay,
    });
  }

  /**
   * Add a function to the retry queue
   * @param {Function} fn - Function to execute with retry
   * @returns {Promise<any>}
   */
  async add(fn) {
    return this.queue.add(async () => this.executeWithRetry(fn));
  }

  /**
   * Execute function with retry logic
   * @param {Function} fn - Function to execute
   * @returns {Promise<any>}
   */
  async executeWithRetry(fn) {
    let lastError = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        debug('Executing attempt:', { attempt: attempt + 1, maxRetries: this.maxRetries + 1 });
        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        debug('Request failed:', {
          attempt: attempt + 1,
          error: lastError.message,
          status: error?.status,
          code: error?.code,
        });

        if (attempt === this.maxRetries) {
          debug('Max retries reached, throwing error');
          throw lastError;
        }

        if (this.shouldRetry(error)) {
          const delay = this.calculateDelay(attempt);
          debug('Retrying after delay:', { delay, nextAttempt: attempt + 2 });
          await this.sleep(delay);
        } else {
          debug('Error not retryable, throwing immediately');
          throw lastError;
        }
      }
    }

    throw lastError;
  }

  /**
   * Check if error should trigger a retry
   * @param {any} error - Error to check
   * @returns {boolean}
   */
  shouldRetry(error) {
    if (typeof error === 'object' && error !== null) {
      const err = error;

      if (err.status === 429) return true;
      if (err.status >= 500) return true;
      if (err.code === 'ECONNRESET') return true;
      if (err.code === 'ECONNREFUSED') return true;
      if (err.code === 'ETIMEDOUT') return true;
      if (err.name === 'AbortError') return true;
      if (err.name === 'TimeoutError') return true;
    }

    return false;
  }

  /**
   * Calculate delay for retry attempt
   * @param {number} attempt - Attempt number
   * @returns {number}
   */
  calculateDelay(attempt) {
    const exponentialDelay = this.baseDelay * Math.pow(2, attempt);
    const jitter = Math.random() * 0.1 * exponentialDelay;
    return exponentialDelay + jitter;
  }

  /**
   * Sleep for specified milliseconds
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise<void>}
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
