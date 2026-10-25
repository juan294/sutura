/** CodeQL's init/analyze/upload steps within a job must use one release. */
export function validateCodeqlReferences(workflow) {
  const errors = [];
  for (const [job, value] of Object.entries(workflow.jobs ?? {})) {
    const refs = new Set((value.steps ?? []).flatMap(step => {
      const match = /^github\/codeql-action\/[^@]+@(.+)$/.exec(step.uses ?? '');
      return match ? [match[1]] : [];
    }));
    if (refs.size > 1) errors.push(`${job}: inconsistent CodeQL references: ${[...refs].join(', ')}`);
  }
  return errors;
}
