/**
 * Retry utility for async operations
 */

export interface RetryOptions {
  maxRetries: number;
  delayMs: number;
  backoffMultiplier: number;
  maxDelayMs: number;
  /** 每次即将重试前回调（261023：资源上传统计重试次数用；不影响重试语义）。 */
  onRetry?: (attempt: number, error: Error) => void;
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxRetries: 3,
  delayMs: 1000,
  backoffMultiplier: 2,
  maxDelayMs: 10000,
};

/**
 * Execute an async function with retry logic
 * @param fn - Async function to execute
 * @param options - Retry options
 * @returns Promise that resolves with the result or rejects after all retries fail
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const config = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | undefined;
  let delay = config.delayMs;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt < config.maxRetries) {
        config.onRetry?.(attempt + 1, lastError);
        await sleep(delay);
        delay = Math.min(delay * config.backoffMultiplier, config.maxDelayMs);
      }
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}