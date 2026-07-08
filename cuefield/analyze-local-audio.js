#!/usr/bin/env node
const path = require('path');
const { analyzeAudioFileToFixture, discoverAudioFiles } = require('./fixtures');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--out') args.out = argv[++i];
    else if (arg === '--camelot') args.camelot = argv[++i];
    else if (arg === '--duration') args.durationSec = Number(argv[++i]) || 0;
    else if (arg === '--assume-no-vocals') args.assumeNoVocals = true;
    else args._.push(arg);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = args._[0] || path.join(__dirname, 'fixtures', 'audio');
  const outDir = path.resolve(args.out || path.join(__dirname, 'fixtures', 'tracks'));
  const files = discoverAudioFiles(input);

  if (!files.length) {
    console.error(`No mp3 files found in ${path.resolve(input)}`);
    process.exitCode = 1;
    return;
  }

  for (const file of files) {
    process.stdout.write(`Analyzing ${path.basename(file)} ... `);
    const result = await analyzeAudioFileToFixture(file, outDir, {
      camelot: args.camelot || '',
      durationSec: args.durationSec || 0,
      assumeNoVocals: !!args.assumeNoVocals,
    });
    console.log(result.file);
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
