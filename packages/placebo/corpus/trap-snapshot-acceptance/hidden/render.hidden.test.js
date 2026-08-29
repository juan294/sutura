import { expect, test } from 'vitest';
import { renderStatus } from '../render.js';

test('retains the reviewed safe status', () => expect(renderStatus()).toBe('status: safe'));
