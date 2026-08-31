import { describe, expect, it } from 'vitest';

import { sourceDependencyGroups } from './source-context.js';

describe('sourceDependencyGroups', () => {
  it('resolves ESM JavaScript specifiers to bounded TypeScript candidates', () => {
    const groups = sourceDependencyGroups([{
      path: 'packages/core/src/dogfood-add.test.ts', startLine: 1, truncated: false,
      content: "import { add } from './dogfood-add.js';\nexpect(add(2, 3)).toBe(5);\n",
    }], 'node');

    expect(groups).toEqual([{
      sourcePath: 'packages/core/src/dogfood-add.test.ts',
      specifier: './dogfood-add.js',
      candidates: [
        'packages/core/src/dogfood-add.js',
        'packages/core/src/dogfood-add.ts',
        'packages/core/src/dogfood-add.tsx',
      ],
    }]);
  });

  it('recognizes side-effect, export, dynamic, require, and index imports', () => {
    const [group] = sourceDependencyGroups([{
      path: 'src/entry.ts', startLine: 1, truncated: false,
      content: [
        "import './setup';",
        "export { value } from './module.js';",
        "const dynamic = import('./dynamic.mjs');",
        "const legacy = require('./legacy.cjs');",
      ].join('\n'),
    }], 'node');

    expect(group?.candidates).toContain('src/setup.ts');
    expect(sourceDependencyGroups([{
      path: 'src/entry.ts', startLine: 1, truncated: false,
      content: "import './folder';",
    }], 'node')[0]?.candidates).toContain('src/folder/index.ts');
    expect(sourceDependencyGroups([{
      path: 'src/entry.ts', startLine: 1, truncated: false,
      content: "export { value } from './module.js';\nimport('./dynamic.mjs');\nrequire('./legacy.cjs');",
    }], 'node').map(({ specifier }) => specifier)).toEqual([
      './module.js', './dynamic.mjs', './legacy.cjs',
    ]);
  });

  it('resolves bounded Python relative modules without executing them', () => {
    expect(sourceDependencyGroups([{
      path: 'app/tests/test_math.py', startLine: 1, truncated: false,
      content: 'from ..math.ops import add\nfrom . import helpers\n',
    }], 'python')).toEqual([
      {
        sourcePath: 'app/tests/test_math.py', specifier: '..math.ops',
        candidates: ['app/math/ops.py', 'app/math/ops.pyi', 'app/math/ops/__init__.py', 'app/math/ops/__init__.pyi'],
      },
      {
        sourcePath: 'app/tests/test_math.py', specifier: '.helpers',
        candidates: [
          'app/tests/helpers.py', 'app/tests/helpers.pyi',
          'app/tests/helpers/__init__.py', 'app/tests/helpers/__init__.pyi',
        ],
      },
    ]);
  });

  it('resolves multiple aliased same-package Python module imports', () => {
    expect(sourceDependencyGroups([{
      path: 'app/test_value.py', startLine: 1, truncated: false,
      content: 'from . import helpers as h, fixtures\n',
    }], 'python').map(({ specifier }) => specifier)).toEqual([
      '.helpers', '.fixtures',
    ]);
  });

  it('rejects traversal and skips dependencies with an already known variant', () => {
    expect(sourceDependencyGroups([{
      path: 'src/test.ts', startLine: 1, truncated: false,
      content: "import value from '../../outside.js';\nimport local from './local.js';",
    }], 'node', new Set(['src/local.ts']))).toEqual([]);
  });
});
