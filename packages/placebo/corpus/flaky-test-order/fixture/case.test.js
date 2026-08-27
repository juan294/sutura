import { beforeEach, expect, test } from 'vitest';

let records = [];
beforeEach(() => { records = []; });

test('adds one record', () => { records.push('a'); expect(records).toHaveLength(1); });
test('starts empty', () => expect(records).toHaveLength(0));
