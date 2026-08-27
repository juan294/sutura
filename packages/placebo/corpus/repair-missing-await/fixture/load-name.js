async function loadName() { return 'Ada'; }
export async function renderName() { return (await loadName()).toUpperCase(); }
