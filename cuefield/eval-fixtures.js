#!/usr/bin/env node
const path = require('path');
const { evaluateFixturePairs, formatRows, loadFixtures } = require('./fixtures');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--limit') args.limit = Number(argv[++i]) || 40;
    else if (!args.dir) args.dir = arg;
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = path.resolve(args.dir || path.join(__dirname, 'fixtures', 'tracks'));
  const fixtures = loadFixtures(dir);
  if (fixtures.length < 2) {
    console.error(`Need at least 2 fixture json files in ${dir}`);
    process.exitCode = 1;
    return;
  }
  const rows = evaluateFixturePairs(fixtures);
  console.log(formatRows(rows, args.limit || 40));
}

main();
