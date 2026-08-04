// scripts/build.js — compiles src/bookmarklet.js into its deployable forms.
// Run: npm run build          (usage: node scripts/build.js [--endpoint URL] [--token T])
//
// Replaces the three previous build scripts, which each re-implemented the same
// minifier and disagreed about the endpoint. The endpoint is now injected here
// rather than string-replaced out of the engine source, so the three payloads
// stay genuinely distinct instead of collapsing into identical copies.
//
// Outputs
//   public/bookmarklet.js              engine served to the cloud loader
//   dist/AEM_QA_BOOKMARK_LOCAL.txt     posts to http://localhost:3500
//   dist/AEM_QA_BOOKMARK_HOSTED.txt    posts to --endpoint (your Railway URL)
//   dist/AEM_QA_BOOKMARK_LOADER.txt    tiny stub that <script>-loads the engine

var fs   = require('fs');
var path = require('path');

var ROOT   = path.join(__dirname, '..');
var SRC    = path.join(ROOT, 'src', 'bookmarklet.js');
var PUBLIC = path.join(ROOT, 'public');
var DIST   = path.join(ROOT, 'dist');

function arg(name, fallback) {
  var i = process.argv.indexOf('--' + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

// Default to the Railway URL from the environment when present, so a Railway
// build produces payloads pointing at itself with no extra configuration.
var railwayHost = process.env.RAILWAY_PUBLIC_DOMAIN;
var DEFAULT_ENDPOINT = railwayHost ? 'https://' + railwayHost + '/api/report' : 'http://localhost:3500/api/report';

var endpoint = arg('endpoint', process.env.QA_ENDPOINT || DEFAULT_ENDPOINT);
var token    = arg('token', process.env.QA_API_TOKEN || '');

var src = fs.readFileSync(SRC, 'utf8');

fs.mkdirSync(DIST, { recursive: true });
fs.mkdirSync(PUBLIC, { recursive: true });

// ─── MINIFIER ────────────────────────────────────────────────────────────
// Deliberately conservative: strips comments and collapses whitespace, and
// nothing else. It is line-oriented, so it must not touch text inside string
// literals — a URL such as "https://x" contains "//" and a naive comment strip
// would truncate the rest of the line.

function stripComments(code) {
  var out = '';
  var inStr = null, inBlock = false, inLine = false, inRegex = false;

  for (var i = 0; i < code.length; i++) {
    var c = code[i], next = code[i + 1], prev = code[i - 1];

    if (inBlock) { if (c === '*' && next === '/') { inBlock = false; i++; } continue; }
    if (inLine)  { if (c === '\n') { inLine = false; out += c; } continue; }

    if (inStr) {
      out += c;
      if (c === '\\') { out += next; i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }

    if (inRegex) {
      out += c;
      if (c === '\\') { out += next; i++; continue; }
      if (c === '/') inRegex = false;
      continue;
    }

    if (c === '"' || c === "'" || c === '`') { inStr = c; out += c; continue; }
    if (c === '/' && next === '*') { inBlock = true; i++; continue; }
    if (c === '/' && next === '/') { inLine = true; i++; continue; }

    // A '/' starts a regex literal (not division) when the previous
    // significant character cannot end an expression.
    if (c === '/') {
      var before = out.replace(/\s+$/, '').slice(-1);
      if (before === '' || '(,=:[!&|?{};+-*%~^<>'.indexOf(before) !== -1) inRegex = true;
      out += c;
      continue;
    }

    out += c;
  }
  return out;
}

function minify(code) {
  return stripComments(code)
    .split('\n')
    .map(function (l) { return l.trim(); })
    .filter(function (l) { return l.length > 0; })
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function configure(code, ep, tok, mode) {
  var out = code
    .replace(/'__QA_ENDPOINT__'/g, JSON.stringify(ep))
    .replace(/'__QA_MODE__'/g, JSON.stringify(mode || 'full'));
  if (tok) {
    // Bake the token into the payload so the bookmarklet can authenticate
    // against a server that has QA_API_TOKEN set.
    out = out.replace('apiToken: userConfig.apiToken || null',
                      'apiToken: userConfig.apiToken || ' + JSON.stringify(tok));
  }
  return out;
}

function toBookmarklet(code) {
  var min = minify(code);
  if (min.indexOf('(function') !== 0) min = '(function(){' + min + '})()';
  return 'javascript:' + encodeURIComponent(min);
}

function write(file, contents, label) {
  fs.writeFileSync(file, contents);
  var kb = (Buffer.byteLength(contents) / 1024).toFixed(1);
  console.log('  ' + label.padEnd(34) + kb.padStart(7) + ' KB  ' + path.relative(ROOT, file));
}

console.log('Building AEM QA bookmarklets');
console.log('  endpoint: ' + endpoint);
console.log('  token   : ' + (token ? 'baked in' : 'none'));
console.log('');

// 1. Engine served over HTTP for the loader stub. Left unminified and with the
//    endpoint placeholder intact — it auto-detects its origin from the <script>
//    tag that loaded it, which is more robust than any baked-in value.
write(path.join(PUBLIC, 'bookmarklet.js'), src, 'engine (served)');

// 2. Self-contained payloads, one per (target × mode).
//    full  — all 49 checks, every link verified (~10-15s)
//    quick — the 15 P1 blockers, links sampled (~2-3s)
[
  ['LOCAL',  'http://localhost:3500/api/report', '',    'localhost:3500'],
  ['HOSTED', endpoint,                            token, 'hosted']
].forEach(function (target) {
  var name = target[0], ep = target[1], tok = target[2], label = target[3];
  ['FULL', 'QUICK'].forEach(function (mode) {
    write(path.join(DIST, 'AEM_QA_BOOKMARK_' + name + '_' + mode + '.txt'),
          toBookmarklet(configure(src, ep, tok, mode.toLowerCase())),
          mode.toLowerCase() + ' → ' + label);
  });
});

// Unsuffixed aliases keep older bookmark installs and docs pointing at the
// full audit rather than 404ing after the mode split.
['LOCAL', 'HOSTED'].forEach(function (name) {
  fs.copyFileSync(path.join(DIST, 'AEM_QA_BOOKMARK_' + name + '_FULL.txt'),
                  path.join(DIST, 'AEM_QA_BOOKMARK_' + name + '.txt'));
});

// 3. Loader stub — small enough to survive any bookmark field, but blocked by
//    CSP on sites that restrict script-src (most production AEM). Prefer the
//    self-contained payloads there.
var loaderOrigin;
try { loaderOrigin = new URL(endpoint).origin; } catch (e) { loaderOrigin = 'http://localhost:3500'; }
var loader = "javascript:(function(){var s=document.createElement('script');"
  + "s.src='" + loaderOrigin + "/bookmarklet.js?v='+Date.now();"
  + "s.onerror=function(){alert('AEM QA: the page blocked the remote script (CSP). "
  + "Use the self-contained bookmarklet instead.');};"
  + "document.head.appendChild(s);})();";
write(path.join(DIST, 'AEM_QA_BOOKMARK_LOADER.txt'), loader, 'loader stub → ' + loaderOrigin);

console.log('\nDone.');
