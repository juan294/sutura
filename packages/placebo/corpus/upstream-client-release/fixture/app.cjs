const got = require('got');
exports.health = () => got('https://service.test').json();
