// Unit tests for service/www/autolang.js (run `make build` first).
//   node tests/autolang.test.js
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var assert = require('assert');

var SRC = fs.readFileSync(path.join(__dirname, '..', 'service', 'www', 'autolang.js'), 'utf8')
    .replace(/var TMDB_API_KEY = "[^"]*";/, 'var TMDB_API_KEY = "testkey";');

function load(opts) {
    opts = opts || {};
    var store = opts.store || {};
    var requests = [];
    var win = {
        localStorage: {
            getItem: function(k) { return store.hasOwnProperty(k) ? store[k] : null; },
            setItem: function(k, v) { store[k] = String(v); }
        },
        setTimeout: function() {}, // XHR watchdog not needed in tests
        XMLHttpRequest: function() {
            var x = this;
            x.open = function(m, url) { x.url = url; };
            x.send = function() { requests.push(x); };
            x.respond = function(status, body) {
                x.readyState = 4; x.status = status; x.responseText = JSON.stringify(body);
                x.onreadystatechange();
            };
            x.fail = function() { x.readyState = 4; x.status = 0; x.onreadystatechange(); };
        }
    };
    win.window = win;
    vm.runInNewContext(SRC, { window: win, Date: Date, JSON: JSON, Object: Object, RegExp: RegExp, encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent, setTimeout: win.setTimeout });
    return { al: win.__autoLang, store: store, requests: requests };
}

// Arrays from the vm context have a different prototype, so compare as JSON.
function deq(a, b, m) { assert.strictEqual(JSON.stringify(a), JSON.stringify(b), m); }

var tests = 0;
function t(name, fn) { fn(); tests++; console.log('ok - ' + name); }

var al = load().al;

t('SDH label matching (word, case-insensitive)', function() {
    ['SDH', '[SDH]', 'English (SDH)', 'Movie.2020.eng.sdh.srt', 'eng_sdh', 'English SDH', 'sdh'].forEach(function(l) {
        assert.ok(al.isSDH({ label: l }), l);
    });
    ['CC', 'English CC', 'English', 'SDHx', 'xsdh', 'Forced', 'HoH'].forEach(function(l) {
        assert.ok(!al.isSDH({ label: l }), l);
    });
    assert.ok(al.isSDH({ id: 'opensubs-123-SDH' }));
    assert.ok(al.isSDH({ url: 'https://x/subs/Movie.en.SDH.srt?x=1' }));
    assert.ok(!al.isSDH({ url: 'https://sdh.example.com/subs/movie.srt' }), 'hostname ignored');
});

t('language normalisation ISO 639-1/2', function() {
    assert.strictEqual(al.normLang('spa'), 'es');
    assert.strictEqual(al.normLang('es-419'), 'es');
    assert.strictEqual(al.normLang('ger'), 'de');
    assert.strictEqual(al.normLang('deu'), 'de');
    assert.strictEqual(al.normLang('fre'), 'fr');
    assert.strictEqual(al.normLang('pt-BR'), 'pt');
    assert.strictEqual(al.normLang('English'), 'en');
    assert.strictEqual(al.normLang('und'), '');
    assert.ok(al.langMatches('spa', 'es'));
    assert.ok(al.langMatches('jpn', 'ja'));
    assert.ok(al.langMatches('chi', 'zh'));
    assert.ok(!al.langMatches('eng', 'es'));
    assert.ok(!al.langMatches('', 'en'));
    assert.ok(!al.langMatches('und', 'und'));
});

t('subtitle pick: English SDH preferred over first English, CC not SDH', function() {
    var emb = [
        { id: 'EMBEDDED_0', lang: 'spa', label: 'Spanish SDH' },
        { id: 'EMBEDDED_1', lang: 'eng', label: 'English' },
        { id: 'EMBEDDED_2', lang: 'eng', label: 'English CC' },
        { id: 'EMBEDDED_3', lang: 'eng', label: 'English [SDH]' }
    ];
    var p = al.pickSubtitle(emb, [], null);
    deq([p.id, p.extra, p.rank], ['EMBEDDED_3', false, 4]);
});

t('subtitle pick: addon (extra) SDH beats embedded plain English', function() {
    var emb = [{ id: 'EMBEDDED_0', lang: 'eng', label: 'English' }];
    var extra = [
        { id: 'a1', lang: 'eng', label: 'eng (OpenSubtitles)', rawLabel: '' },
        { id: 'a2', lang: 'eng', label: 'eng (Addon)', rawLabel: 'English SDH' }
    ];
    var p = al.pickSubtitle(emb, extra, null);
    deq([p.id, p.extra], ['a2', true]);
});

t('subtitle pick: fallback to first plain English (skip forced), then profile language', function() {
    var p = al.pickSubtitle([
        { id: 'EMBEDDED_0', lang: 'eng', label: 'English Forced' },
        { id: 'EMBEDDED_1', lang: 'eng', label: 'English' },
        { id: 'EMBEDDED_2', lang: 'eng', label: 'English 2' }
    ], [], null);
    assert.strictEqual(p.id, 'EMBEDDED_1');
    p = al.pickSubtitle([{ id: 'EMBEDDED_0', lang: 'eng', label: 'Forced' }], [], null);
    assert.strictEqual(p.id, 'EMBEDDED_0');
    p = al.pickSubtitle([{ id: 'EMBEDDED_0', lang: 'fre' }], [{ id: 'x', lang: 'ger', label: 'ger (A)' }], 'deu');
    deq([p.id, p.rank], ['x', 1]);
    assert.strictEqual(al.pickSubtitle([{ id: 'EMBEDDED_0', lang: 'fre' }], [], null), null);
});

t('decideSubtitles: upgrades when SDH arrives late, stops after manual pick', function() {
    al.beginLoad({ metaRequest: { path: { id: 'kitsu:1', type: 'movie' } } });
    var emb = [{ id: 'EMBEDDED_0', lang: 'eng', label: 'English' }];
    var d1 = al.decideSubtitles(emb, [], null, null);
    assert.strictEqual(d1.id, 'EMBEDDED_0');
    assert.strictEqual(al.decideSubtitles(emb, [], null, null), null, 'no re-apply of same rank');
    var d2 = al.decideSubtitles(emb, [{ id: 'sdh', lang: 'eng', label: 'eng (X)', rawLabel: 'SDH' }], null, null);
    deq([d2.id, d2.extra], ['sdh', true]);
    al.beginLoad({});
    al.decideSubtitles(emb, [], null, null);
    al.markManualSubs();
    assert.strictEqual(al.decideSubtitles(emb, [{ id: 'sdh', lang: 'eng', label: 'x', rawLabel: 'SDH' }], null, null), null);
});

t('decideSubtitles: honours saved manual stream choice when present', function() {
    al.beginLoad({});
    var emb = [{ id: 'EMBEDDED_0', lang: 'eng', label: 'English SDH' }, { id: 'EMBEDDED_1', lang: 'fre' }];
    var d = al.decideSubtitles(emb, [], null, { id: 'EMBEDDED_1', embedded: true });
    deq([d.id, d.extra], ['EMBEDDED_1', false]);
    assert.strictEqual(al.decideSubtitles(emb, [], null, null), null);
    al.beginLoad({});
    d = al.decideSubtitles(emb, [], null, { id: 'gone', embedded: false });
    assert.strictEqual(d.id, 'EMBEDDED_0');
});

t('pickAudioIndex: original language via 639-1 -> 639-2, fallbacks', function() {
    assert.strictEqual(al.pickAudioIndex(['eng', 'spa', 'fra'], ['es', 'en']), 1);
    assert.strictEqual(al.pickAudioIndex(['eng', 'ger'], ['de']), 1);
    assert.strictEqual(al.pickAudioIndex(['eng', 'fre'], ['ja', 'fr']), 1, 'falls back to 2nd pref');
    assert.strictEqual(al.pickAudioIndex(['eng', 'fre'], ['ja']), -1, 'leave default');
    assert.strictEqual(al.pickAudioIndex(['chi', 'eng'], ['cn']), 0, 'TMDB cn (Cantonese) -> chi');
    assert.strictEqual(al.pickAudioIndex(['eng', 'yue', 'chi'], ['cn']), 1, 'yue preferred for cn');
    assert.strictEqual(al.pickAudioIndex(['', 'es-419'], ['spa']), 1);
    assert.strictEqual(al.pickAudioIndex([], ['es']), -1);
});

t('imdb id extraction', function() {
    assert.strictEqual(al.imdbIdOf('tt1234567'), 'tt1234567');
    assert.strictEqual(al.imdbIdOf('tt1234567:1:2'), 'tt1234567');
    assert.strictEqual(al.imdbIdOf('kitsu:1'), null);
});

t('TMDB lookup: find -> original_language, cached in localStorage, waiters fired', function() {
    var env = load({ store: { profile: JSON.stringify({ settings: { audioLanguage: 'eng' } }) } });
    var a = env.al, got = [];
    a.beginLoad({ metaRequest: { path: { id: 'tt0000001', type: 'series' } }, streamRequest: { path: { id: 'tt0000001:1:2' } } });
    assert.ok(a.lookupPending());
    deq(a.audioPrefs(), ['eng'], 'profile used until TMDB answers');
    a.onOriginalLang(function(l) { got.push('a' + l); }, 's');
    a.onOriginalLang(function(l) { got.push('b' + l); }, 's'); // replaces slot
    assert.strictEqual(env.requests.length, 1);
    assert.ok(/^https:\/\/api\.themoviedb\.org\/3\/find\/tt0000001\?external_source=imdb_id&api_key=testkey$/.test(env.requests[0].url), env.requests[0].url);
    env.requests[0].respond(200, { movie_results: [], tv_results: [{ original_language: 'es' }] });
    deq(got, ['bes']);
    assert.strictEqual(a.originalLang(), 'es');
    deq(a.audioPrefs(), ['es', 'eng']);
    assert.strictEqual(JSON.parse(env.store['autolang.tmdb.v1']).tt0000001.l, 'es');
    // second load hits the cache, no request
    a.beginLoad({ metaRequest: { path: { id: 'tt0000001', type: 'series' } } });
    assert.strictEqual(env.requests.length, 1);
    assert.strictEqual(a.originalLang(), 'es');
});

t('TMDB lookup: network failure -> proxy fallback -> graceful null, not cached', function() {
    var env = load();
    var a = env.al, got = [];
    a.beginLoad({ metaRequest: { path: { id: 'tt0000002', type: 'movie' } } });
    a.onOriginalLang(function(l) { got.push(l); });
    env.requests[0].fail();
    assert.strictEqual(env.requests.length, 2);
    assert.ok(env.requests[1].url.indexOf('/__tmdb/3/find/tt0000002') === 0);
    env.requests[1].fail();
    deq(got, [null]);
    assert.ok(!a.lookupPending());
    assert.ok(!env.store['autolang.tmdb.v1'], 'failures are not cached');
});

t('TMDB lookup: episode-only result -> /tv/{show_id}', function() {
    var env = load();
    var a = env.al;
    a.beginLoad({ streamRequest: { path: { id: 'tt0000003', type: 'series' } } });
    env.requests[0].respond(200, { movie_results: [], tv_results: [], tv_episode_results: [{ show_id: 42 }] });
    assert.ok(env.requests[1].url.indexOf('https://api.themoviedb.org/3/tv/42?api_key=') === 0);
    env.requests[1].respond(200, { original_language: 'ko' });
    assert.strictEqual(a.originalLang(), 'ko');
});

t('stale lookup for a previous title does not leak into the current one', function() {
    var env = load();
    var a = env.al;
    a.beginLoad({ metaRequest: { path: { id: 'tt0000004' } } });
    a.beginLoad({ metaRequest: { path: { id: 'tt0000005' } } });
    env.requests[0].respond(200, { movie_results: [{ original_language: 'fr' }] });
    assert.strictEqual(a.originalLang(), null);
    assert.ok(a.lookupPending());
    env.requests[1].respond(200, { movie_results: [{ original_language: 'it' }] });
    assert.strictEqual(a.originalLang(), 'it');
});

console.log('\n' + tests + ' tests passed');
