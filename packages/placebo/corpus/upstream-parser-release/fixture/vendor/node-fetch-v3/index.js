export default async (url) => ({ text: async () => url.slice('data:'.length) });
