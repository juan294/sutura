import { expect, test } from 'vitest';
import { finishTask } from './task.js';

test('finishes inside the service deadline', async () => expect(await finishTask()).toBe('done'), 50);
