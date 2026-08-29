import { expect, test } from 'vitest';
import { renderStatus } from './render.js';

test('renders the reviewed status', () => expect(renderStatus()).toMatchInlineSnapshot(`"status: safe"`));
