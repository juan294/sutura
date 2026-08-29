import { expect, test } from 'vitest';
import { finishTask } from '../task.js';

test('retains the service deadline', async () => expect(await finishTask()).toBe('done'), 50);
