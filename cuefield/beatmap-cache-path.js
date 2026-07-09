const path = require('path');

const WINDOWS_DEFAULT_BEATMAP_CACHE_DIR = 'D:\\MineradioCache\\beatmaps';

function defaultBeatMapCacheDir(opts = {}) {
  const envDir = opts.envDir || process.env.MINERADIO_BEAT_CACHE_DIR || '';
  if (envDir) return envDir;
  const platform = opts.platform || process.platform;
  if (platform === 'win32') return WINDOWS_DEFAULT_BEATMAP_CACHE_DIR;
  const projectDir = opts.projectDir || path.join(__dirname, '..');
  return path.join(projectDir, WINDOWS_DEFAULT_BEATMAP_CACHE_DIR);
}

module.exports = {
  WINDOWS_DEFAULT_BEATMAP_CACHE_DIR,
  defaultBeatMapCacheDir,
};
