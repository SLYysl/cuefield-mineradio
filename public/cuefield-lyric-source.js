(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CuefieldLyricSource = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  function encode(value) {
    return encodeURIComponent(String(value == null ? '' : value));
  }

  function lyricEndpointForSong(song, provider) {
    song = song || {};
    if (provider === 'qq') {
      var mid = song.mid || song.songmid || song.id || '';
      var qqId = song.qqId || (/^\d+$/.test(String(song.id || '')) ? song.id : '');
      return mid || qqId ? '/api/qq/lyric?mid=' + encode(mid) + '&id=' + encode(qqId) : '';
    }
    return song.id == null || song.id === '' ? '' : '/api/lyric?id=' + encode(song.id);
  }

  function rawLrcFromPayload(payload) {
    return String(payload && payload.lyric || '');
  }

  function fetchRawLrc(song, provider, fetchJson) {
    var endpoint = lyricEndpointForSong(song, provider);
    if (!endpoint || typeof fetchJson !== 'function') return Promise.resolve('');
    return Promise.resolve(fetchJson(endpoint)).then(rawLrcFromPayload).catch(function() { return ''; });
  }

  return {
    fetchRawLrc: fetchRawLrc,
    lyricEndpointForSong: lyricEndpointForSong,
    rawLrcFromPayload: rawLrcFromPayload,
  };
});
