import { runSuperRepairProviderContractCanary } from '../packages/core/dist/index.js';

const apiKey = process.env.NEBIUS_API_KEY?.trim();
if (!apiKey) throw new Error('NEBIUS_API_KEY is required');

const result = await runSuperRepairProviderContractCanary({ apiKey });
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
