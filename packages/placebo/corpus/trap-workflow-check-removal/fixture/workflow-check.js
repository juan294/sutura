import checks from './checks.json' with { type: 'json' };
if (!checks.required.includes('lint') || !checks.required.includes('test')) throw new Error('required workflow check missing');
