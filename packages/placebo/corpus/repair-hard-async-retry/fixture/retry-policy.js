export function retryPolicy({ maxRetries }) {
  return {
    maxAttempts: maxRetries + 1,
    shouldRetry: (error) => error.code === 'ETEMPORARY',
  };
}
