export function artifactKey(name, context) {
  return `${name}:${context.compilerMajor}:${context.mode}`;
}
