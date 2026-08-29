export async function finishTask(delayMs = 10) { await new Promise((resolve) => setTimeout(resolve, delayMs)); return 'done'; }
