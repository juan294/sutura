const execa = require('execa');
exports.nodeVersion = () => execa('node', ['--version']).stdout;
