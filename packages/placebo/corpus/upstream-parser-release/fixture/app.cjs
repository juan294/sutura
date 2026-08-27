const fetch = require('node-fetch');
exports.fetchName = () => fetch('data:Juan').then((response) => response.text());
