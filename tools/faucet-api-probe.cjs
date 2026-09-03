const s = require('fs').readFileSync(process.env.TEMP + '\\faucet.js', 'utf8');
const i = s.indexOf('/request-tokens');
console.log(s.slice(Math.max(0, i - 900), i + 300));
