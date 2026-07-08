#!/usr/bin/env node
const path = require('path');
const { decodeNcmFile } = require('./decode-ncm');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') args.out = argv[++i];
    else args._.push(argv[i]);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = args._[0];
  if (!input) {
    console.error('Usage: node cuefield/decode-ncm-cli.js <file.ncm> [--out cuefield/fixtures/audio]');
    process.exitCode = 1;
    return;
  }
  const outDir = path.resolve(args.out || path.join(__dirname, 'fixtures', 'audio'));
  const result = decodeNcmFile(input, outDir);
  console.log(JSON.stringify(result, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
}
