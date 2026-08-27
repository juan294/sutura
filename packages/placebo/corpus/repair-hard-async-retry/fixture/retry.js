export async function retry(operation, policy) {
  let lastError;
  for (let attempt = 0; attempt < policy.maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!policy.shouldRetry(error)) throw error;
    }
  }
  throw lastError;
}
