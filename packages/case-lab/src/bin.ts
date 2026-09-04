const USAGE = [
  'Usage:',
  '  case-lab catalog --out <dir>',
  '  case-lab replay <case-id> [--out <file>]',
].join('\n');

process.stderr.write(`${USAGE}\n`);
process.exit(2);
