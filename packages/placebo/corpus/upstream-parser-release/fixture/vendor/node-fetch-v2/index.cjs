module.exports = async (url) => ({ text: async () => url.slice('data:'.length) });
