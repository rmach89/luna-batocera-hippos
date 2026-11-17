'use strict';
// Amazon Luna for Batocera: a fullscreen window that only opens Amazon
// Luna (luna.amazon.*) and Amazon's own sign-in and account pages.
// Everything else is blocked. Unofficial; not made or endorsed by Amazon.
const electron = require('electron');
const { app, BrowserWindow, WebContentsView, session, ipcMain, Menu, powerSaveBlocker, nativeImage, net } = electron;
const { execFile } = require('child_process');
const { pathToFileURL } = require('url');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const rules = require('./rules');
const i18n = require('./i18n');

const HOME = process.env.LUNA_HOME || '/userdata/system/add-ons/luna';
const CONFIG = path.join(HOME, 'config.json');
const LOG = process.env.LUNA_APP_LOG || '/userdata/system/logs/luna-app.log';
// created when you choose "Don't show this again" on the exit tip
const TIP_HIDDEN = path.join(HOME, 'exit-tip-hidden');
// the version of this package (shown in Settings)
const VERSION = require('./package.json').version;
// when the intro video last played ("once a day")
const INTRO_LAST = path.join(HOME, 'intro-last-played');
// the intro video played when the app opens (while Luna loads behind it)
const INTRO_VIDEO = path.join(HOME, 'luna-intro.mp4');
// the same video as WebM (VP9), which every browser engine build plays; tried first
const INTRO_WEBM = path.join(HOME, 'luna-intro.webm');
// and as an animated picture, for engines that can't decode video at all (shown
// with the soundtrack played on its own)
const INTRO_FRAMES = path.join(HOME, 'luna-intro-frames.webp');
// and its soundtrack on its own (the picture version plays it; no video decoding needed)
const INTRO_AUDIO = path.join(HOME, 'luna-intro-audio.ogg');
// left by older versions (children mode); removed on start
const KIDS_FILE = path.join(HOME, 'children-mode');
// sets up and updates the browser engine
const BUILD_RUNTIME = path.join(HOME, 'Build-Runtime.py');

const DEFAULTS = {
  // Amazon Luna's own site for the region (Settings > Region picks another)
  start_url: 'https://luna.amazon.com/',
  // Amazon's own sites: Luna in every country it's offered, and Amazon's
  // sign-in, account and Prime / Luna subscription pages. Nothing else.
  allowed: [
    'amazon.com', '*.amazon.com', 'amazon.ca', '*.amazon.ca', 'amazon.co.uk', '*.amazon.co.uk',
    'amazon.de', '*.amazon.de', 'amazon.fr', '*.amazon.fr', 'amazon.it', '*.amazon.it',
    'amazon.es', '*.amazon.es', 'amazon.nl', '*.amazon.nl', 'amazon.pl', '*.amazon.pl',
    'amazon.com.be', '*.amazon.com.be', 'amazon.pt', '*.amazon.pt', 'amazon.se', '*.amazon.se',
    '*.media-amazon.com', '*.a2z.com'
  ],
  user_agent: '',
  exit_hold_seconds: 2,
  show_exit_tip: true,
  keyboard_highlight: true,
  volume: 100,
  muted: false,              // the app's sound turned off (Settings > Volume)
  play_intro: true,          // true = every time, "daily" = once a day, false = never
  intro_volume: 100,         // the intro video's sound, 0-100
  intro_muted: false,        // true = the intro video plays silently
  stream_as_windows: true,   // Luna turns Linux browsers away: the app always says it's Chrome on Windows
  stream_resolution: 'auto', // the stream size asked for: 'auto' (720p), '1080p', '1080p-hq' or '1440p'
  video_sharpen: 'off',      // a sharpening filter on the stream: 'off', 'low', 'medium' or 'high'
  clarity_boost: false,      // a little more contrast and colour in the stream's picture
  video_contrast: 100,       // the stream's picture, 50-150% (100 = unchanged)
  video_saturation: 100,
  video_brightness: 100,
  stream_stats: false,       // a small box with the stream's resolution, fps, ping, bitrate...
  vibration: 100,            // controller vibration strength in games, 0 (off) to 100%
  audio_boost: 100,          // the game's sound, 100 (as it is) to 600%
  prefer_ipv6: false,        // connect to the game server over IPv6 when there is one
  wait_time: true,           // a game's page shows the wait for a server
  mic_on_launch: false,      // turn the microphone on when a game starts
  touch_controller: false,   // see-through controller buttons over the game for touch screens
  no_social: false,          // don't load friends, messages and suggested people
  region_unlock: 'off',      // play as if in another country: 'off', 'au', 'br', 'eu', 'jp', 'kr' or 'us'
  upscale_4k: false,         // 64-bit PCs: the stream scaled up to the screen on the graphics chip, then sharpened
  skip_splash: false,        // skip the Xbox splash video as a game starts
  no_feedback: false,        // no "how was it?" questions after a game
  reduce_anim: false,        // fewer animations on the dashboard (smoother on slower devices)
  no_analytics: false,       // don't send Xbox's usage statistics
  upscale_target: 'screen',  // the upscaler's size: 'screen', '1080', '1440' or '2160' (4K)
  upscale_sharp: 60,         // the upscaler's sharpening, 0-100%
  video_cleanup: false,      // soften compression blocks in flat areas of the picture (graphics chip)
  stream_steady: false,      // ask Xbox to keep the bitrate up for the chosen resolution
  picture_per_game: false,   // quick settings saves the picture settings for the game being played
  split_players: 0,          // split screen: 0 (off), 2, 3 or 4 players, each with their own Xbox sign-in and controller
  split_remember: false,     // split screen: players 2-4's guest sign-ins kept for next time (otherwise forgotten when the app closes)
  replay: false,             // instant replay: keep the last 30 seconds of a game, saved from quick settings
  keep_alive: false,         // answer Xbox's "are you still there?" during a game
  auto_reconnect: true,      // a dropped stream: press Xbox's own reconnect button
  language: 'auto',          // 'auto' = the same as Batocera
  controller_fix: true,      // put controllers the browser doesn't know (Steam Deck...) in the Xbox layout
  game_list: 'off',          // EmulationStation's Luna list: 'off' (just the app), 'all' Luna games or 'picked' ones
  dashboard_nav: false,      // the app moves around Luna's own pages with the D-pad (for when Luna doesn't react to the controller)
  game_list_3d: false,       // the games' pictures in that list: 3D cases instead of the flat box art
  sign_out_on_exit: false,   // sign out of Amazon every time the app closes
  gpu_acceleration: false
};
// the stream options' choices (Settings)
const STREAM_RES = ['auto', '1080p', '1080p-hq', '1440p'];
const SHARPEN = ['off', 'low', 'medium', 'high'];
const VIBRATION = [0, 25, 50, 75, 100];
const BOOST = [100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600];
// Region unlock: the address Amazon Luna is told the requests come
// from (X-Forwarded-For): a public address in that country. No VPN; the same
// risk as one.
const UNLOCK = { au: '203.41.44.20', br: '200.221.11.101', eu: '194.25.0.68', jp: '122.1.0.154', kr: '203.253.64.1', us: '4.2.2.2' };
const UNLOCK_CODES = ['off'].concat(Object.keys(UNLOCK));
// the 4K upscaler is for 64-bit PCs (x86-64) only
const X64 = (process.env.LUNA_ARCH || process.arch) === 'x64';   // (LUNA_ARCH: for the tests)
const UP_TARGETS = ['screen', '1080', '1440', '2160'];
const SPLITS = [0, 2, 3, 4];
// the picture settings a game can have of its own (Picture settings per game)
const PIC_KEYS = ['video_sharpen', 'clarity_boost', 'video_contrast', 'video_saturation', 'video_brightness', 'upscale_4k', 'upscale_target', 'upscale_sharp', 'video_cleanup'];
const GAME_PIC = path.join(HOME, 'game-picture.json');
function gamePics() { try { return JSON.parse(fs.readFileSync(GAME_PIC, 'utf8')) || {}; } catch (e) { return {}; } }
function picOwner() { return curProfile ? curProfile.id : '_'; }
// the game on Luna now (its ID), from /game/<name>/<ID>
function streamingGame() {
  try { const g = gameFromUrl(mainWin.webContents.getURL()); return g ? g.id : ''; } catch (e) { return ''; }
}
// cfg with the playing game's own picture settings on top (when there are any)
function picCfg() {
  if (!cfg.picture_per_game) return cfg;
  const g = streamingGame(), own = g && (gamePics()[picOwner()] || {})[g];
  return own ? Object.assign({}, cfg, own) : cfg;
}
// Xbox's usage statistics and error reports (Disable analytics)
const ANALYTICS_URLS = ['*://arc.msn.com/*', '*://browser.events.data.microsoft.com/*', '*://dc.services.visualstudio.com/*', '*://*.ingest.sentry.io/*',
  '*://js.monitor.azure.com/*', '*://*.clarity.ms/*'];
const PICTURE = ['video_contrast', 'video_saturation', 'video_brightness'];
// 50-150 in steps of 5; anything else is 100 (unchanged)
function pictureLevel(v) { const n = Number(v); return Number.isFinite(n) ? Math.round(Math.min(150, Math.max(50, n)) / 5) * 5 : 100; }
// the script that does them, in the Luna page (stream.js)
let STREAM_JS = '';
try { STREAM_JS = fs.readFileSync(path.join(__dirname, 'stream.js'), 'utf8'); } catch (e) { /* logged at startup */ }
function streamCfg() {
  const pc = picCfg();
  return { res: cfg.stream_resolution, sharpen: SHARPEN.indexOf(pc.video_sharpen), clarity: pc.clarity_boost, stats: cfg.stream_stats, vib: cfg.vibration,
    contrast: pc.video_contrast, saturation: pc.video_saturation, brightness: pc.video_brightness,
    upTarget: pc.upscale_target, upSharp: pc.upscale_sharp, clean: pc.video_cleanup, steady: cfg.stream_steady,
    alive: cfg.keep_alive, reconnect: cfg.auto_reconnect,
    boost: cfg.audio_boost, vol: appVolume(), ipv6: cfg.prefer_ipv6, wait: cfg.wait_time, mic: cfg.mic_on_launch,
    up: pc.upscale_4k && X64, splash: cfg.skip_splash, fb: cfg.no_feedback, anim: cfg.reduce_anim,
    waitT: { label: i18n.t(cfg.language, 'waitLabel'), none: i18n.t(cfg.language, 'waitNone'), min: i18n.t(cfg.language, 'waitMin') } };
}
function streamScript() {
  return `window.__lunaStreamCfg = ${JSON.stringify(streamCfg())}; ${STREAM_JS}`;
}
// Luna's own site in any country (luna.amazon.com, luna.amazon.co.uk, ...),
// not Amazon's sign-in or account pages
const LUNA_HOST = /^luna\.amazon\.(com|ca|co\.uk|de|fr|it|es|nl|pl|com\.be|pt|se)$/i;
function isLunaHost(host) { return LUNA_HOST.test(String(host || '')); }
function onLunaSite(url) { try { const u = new URL(String(url || '')); return u.protocol === 'https:' && isLunaHost(u.hostname); } catch (e) { return false; } }
const onXboxPlay = onLunaSite;   // (the name the stream options use)
function applyStreamOptions(wc) {
  if (!wc) return;
  try {
    if (!onXboxPlay(wc.getURL())) return;
    wc.executeJavaScript(`${streamScript()} window.__lunaStreamSet(${JSON.stringify(streamCfg())});`).catch(() => { /* page between loads */ });
  } catch (e) { /* closed */ }
}
// earlier versions' default start page, which now just redirects
const OLD_DEFAULT_START = /^$/;   // (none yet)

function log(msg) {
  try { fs.appendFileSync(LOG, `${new Date().toISOString()} ${msg}\n`); } catch (e) { /* ignore */ }
}
// keep the log small: over 1 MB, keep just the newest 256 KB
(function trimLog() {
  try {
    const size = fs.statSync(LOG).size;
    if (size <= 1024 * 1024) return;
    const keep = 256 * 1024;
    const fd = fs.openSync(LOG, 'r');
    const buf = Buffer.alloc(keep);
    fs.readSync(fd, buf, 0, keep, size - keep);
    fs.closeSync(fd);
    const text = buf.toString('utf8');
    fs.writeFileSync(LOG, `${new Date().toISOString()} (log trimmed to its newest part)\n` + text.slice(text.indexOf('\n') + 1));
  } catch (e) { /* no log yet */ }
})();

const profiles = require('./profiles').create(HOME, log);
// the profile playing now (null until profiles are set up)
let curProfile = null;   // (no profiles on Luna: one Amazon sign-in for the whole machine)

function loadConfig(profileId) {
  let user = {};
  try {
    user = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  } catch (e) {
    log(`config.json not used (${e.message}); using built-in settings`);
  }
  // a profile's own Settings choices on top of config.json
  if (profileId) Object.assign(user, profiles.settings(profileId));
  const cfg = Object.assign({}, DEFAULTS, user);
  // the built-in sites are always allowed; config.json's "allowed" adds to them
  const extra = Array.isArray(user.allowed) ? user.allowed : [];
  cfg.allowed = Array.from(new Set(DEFAULTS.allowed.concat(extra)));
  if (typeof cfg.start_url !== 'string' || !/^https:\/\//i.test(cfg.start_url)) cfg.start_url = DEFAULTS.start_url;
  cfg.gpu_acceleration = cfg.gpu_acceleration === true;
  cfg.keyboard_highlight = cfg.keyboard_highlight !== false;
  const hold = Number(cfg.exit_hold_seconds);
  cfg.exit_hold_seconds = hold >= 0.5 && hold <= 10 ? hold : DEFAULTS.exit_hold_seconds;
  cfg.show_exit_tip = cfg.show_exit_tip !== false;
  cfg.introMode = cfg.play_intro === false ? 'off' : cfg.play_intro === 'daily' ? 'daily' : 'always';
  cfg.stream_as_windows = cfg.stream_as_windows === true;
  cfg.stream_resolution = STREAM_RES.includes(cfg.stream_resolution) ? cfg.stream_resolution : 'auto';
  cfg.video_sharpen = SHARPEN.includes(cfg.video_sharpen) ? cfg.video_sharpen : 'off';
  cfg.stream_stats = cfg.stream_stats === true;
  cfg.clarity_boost = cfg.clarity_boost === true;
  for (const k of PICTURE) cfg[k] = pictureLevel(cfg[k]);
  const vib = Number(cfg.vibration);
  cfg.vibration = Number.isFinite(vib) ? Math.round(Math.min(100, Math.max(0, vib)) / 25) * 25 : DEFAULTS.vibration;
  const boost = Number(cfg.audio_boost);
  cfg.audio_boost = Number.isFinite(boost) ? Math.round(Math.min(600, Math.max(100, boost)) / 50) * 50 : 100;
  for (const k of ['prefer_ipv6', 'mic_on_launch', 'touch_controller', 'no_social', 'upscale_4k', 'skip_splash', 'no_feedback', 'reduce_anim', 'no_analytics']) cfg[k] = cfg[k] === true;
  cfg.wait_time = cfg.wait_time !== false;
  for (const k of ['video_cleanup', 'stream_steady', 'picture_per_game', 'split_remember', 'replay', 'keep_alive']) cfg[k] = cfg[k] === true;
  cfg.auto_reconnect = cfg.auto_reconnect !== false;
  cfg.upscale_target = UP_TARGETS.includes(String(cfg.upscale_target)) ? String(cfg.upscale_target) : 'screen';
  const us = Number(cfg.upscale_sharp);
  cfg.upscale_sharp = Number.isFinite(us) ? Math.round(Math.min(100, Math.max(0, us)) / 10) * 10 : 60;
  cfg.split_players = SPLITS.includes(Number(cfg.split_players)) ? Number(cfg.split_players) : 0;
  cfg.region_unlock = UNLOCK_CODES.includes(cfg.region_unlock) ? cfg.region_unlock : 'off';
  const iv = Number(cfg.intro_volume);
  cfg.intro_volume = Number.isFinite(iv) ? Math.round(Math.min(100, Math.max(0, iv))) : DEFAULTS.intro_volume;
  cfg.intro_muted = cfg.intro_muted === true;
  // the app's own text: Batocera's language unless one is picked in Settings
  const choice = String(cfg.language || 'auto');
  cfg.languageChoice = i18n.STRINGS[choice] ? choice : 'auto';
  cfg.language = cfg.languageChoice === 'auto' ? batoceraLanguage() : cfg.languageChoice;
  // the app's sound level, 0 (silent) to 100 (full)
  const vol = Number(cfg.volume);
  cfg.volume = Number.isFinite(vol) ? Math.round(Math.min(100, Math.max(0, vol))) : DEFAULTS.volume;
  cfg.muted = cfg.muted === true;
  cfg.sign_out_on_exit = cfg.sign_out_on_exit === true;
  cfg.dashboard_nav = cfg.dashboard_nav === true;
  if (!['off', 'all', 'picked'].includes(cfg.game_list)) cfg.game_list = 'off';
  cfg.game_list_3d = false;
  // Xbox Cloud Gaming's own tricks, which Luna doesn't have: always off here
  // (the settings stay in the code they came from, but nothing turns them on)
  Object.assign(cfg, LUNA_FIXED);
  return cfg;
}
// What Luna can't do (or the app can't do on Luna yet): these stay as shown
// whatever config.json says. Luna turns Linux browsers away, so the app
// always says it's Chrome on Windows.
const LUNA_FIXED = {
  stream_as_windows: true, stream_resolution: 'auto', region_unlock: 'off', no_social: false, no_analytics: false,
  prefer_ipv6: false, wait_time: false, mic_on_launch: false, touch_controller: false, skip_splash: false, no_feedback: false,
  reduce_anim: false, stream_steady: false, keep_alive: false, auto_reconnect: false, split_players: 0, split_remember: false,
  upscale_4k: false, video_cleanup: false, replay: false, picture_per_game: false, audio_boost: 100, vibration: 100
};

// Batocera's language (system.language in batocera.conf, e.g. de_DE), as one
// of the app's languages
// HippOS (a Debian-based gaming system built like Batocera) runs this too
const HIPPOS_VERSION_FILE = process.env.LUNA_HIPPOS_VERSION || '/usr/share/hippos/version';
const ON_HIPPOS = (() => { try { return fs.existsSync(HIPPOS_VERSION_FILE); } catch (e) { return false; } })();
// the system's language: Batocera's batocera.conf, or HippOS's hippos.conf
// (the same kind of file; batocera.conf is still read there if it has one)
function batoceraLanguage() {
  const confs = ON_HIPPOS
    ? [process.env.LUNA_HIPPOS_CONF || '/userdata/system/hippos.conf', process.env.LUNA_BATOCERA_CONF || '/userdata/system/batocera.conf']
    : [process.env.LUNA_BATOCERA_CONF || '/userdata/system/batocera.conf'];
  let loc = '';
  for (const conf of confs) {
    try {
      const m = fs.readFileSync(conf, 'utf8').match(/^[ \t]*system\.language[ \t]*=[ \t]*([A-Za-z_.@-]+)/m);
      if (m) { loc = m[1]; break; }
    } catch (e) { /* not there */ }
  }
  if (!loc) loc = process.env.LANGUAGE || process.env.LC_ALL || process.env.LANG || '';
  return i18n.fromLocale(loc);
}

const cfg = loadConfig(curProfile && curProfile.id);
const allowList = rules.compile(cfg.allowed);
// the start page is always allowed
try {
  const s = new URL(cfg.start_url);
  allowList.push(rules.compileRule(s.hostname + s.pathname));
} catch (e) { /* already validated */ }
// Children's and teens' profiles (from Xbox-era backups): the plan itself limits what they can play
// and buy. The app only keeps them out of adults' profiles: when a child's
// or teen's profile is set up here, adult profiles need the PIN.
function isMinor(p) { return !!p && (p.age === 'Child' || p.age === 'Teen'); }
function minorsHere() { return profiles.list.some(isMinor); }
try { fs.unlinkSync(KIDS_FILE); } catch (e) { /* not there */ }
const isAllowed = url => rules.isAllowed(url, allowList);

// keep this app's sign-in separate from anything else on the system
app.setPath('userData', path.join(HOME, 'profile'));
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Luna turns Linux browsers away. The user agent says Chrome on Windows
// (cleanUserAgent), and the browser's "client hints" (which would still say
// Linux) are turned off so the two agree.
app.commandLine.appendSwitch('disable-features', 'UserAgentClientHint');
// optional (Settings > GPU acceleration): ask Chromium to use the graphics
// chip even where it normally wouldn't, including decoding the game's video
// (VA-API). Read once at start, so a change applies the next time the app opens.
// Safe mode (--safe, or LB + RB held as the app opens): GPU acceleration and split
// screen off before the engine starts; the rest is turned off once it's running
const SAFE_ARG = process.argv.includes('--safe');
if (SAFE_ARG) { cfg.gpu_acceleration = false; cfg.split_players = 0; }
const GPU_AT_START = cfg.gpu_acceleration;
const SPLIT_AT_START = cfg.split_players;
const APP_START = Date.now();
if (GPU_AT_START) {
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
  app.commandLine.appendSwitch('enable-gpu-rasterization');
  app.commandLine.appendSwitch('enable-zero-copy');
  app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder,VaapiVideoDecodeLinuxGL,VaapiIgnoreDriverChecks,AcceleratedVideoDecodeLinuxGL');
}
// what the graphics chip is doing, for the log (after start)
function logGpu() {
  try {
    const f = app.getGPUFeatureStatus() || {};
    log(`gpu: acceleration ${GPU_AT_START ? 'on' : 'off'}; engine reports video decode ${f.video_decode || '?'}, compositing ${f.gpu_compositing || '?'}, webgl ${f.webgl || '?'}`);
  } catch (e) { /* not available */ }
}

// sites to open connections to early, while the start screen is up
function warmUp() { return [`https://${lunaHost()}`, 'https://www.amazon.com', 'https://m.media-amazon.com']; }

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let mainWin = null;
// the browser storage (sign-in) of a profile; the first profile (and the app
// without profiles) uses the original one
function sessionFor(p) {
  const part = profiles.partition(p);
  return part ? session.fromPartition(part) : session.defaultSession;
}
function curSession() { return sessionFor(curProfile); }
const sessionsReady = new Set();
let unlockLogged = false, socialLogged = false, analyticsLogged = false;
function hostOf(u) { try { return new URL(u).hostname; } catch (e) { return ''; } }
function setupSession(ses) {
  if (sessionsReady.has(ses)) return;
  sessionsReady.add(ses);
  const okPermissions = new Set(['fullscreen', 'pointerLock', 'keyboardLock', 'clipboard-sanitized-write']);
  try {
    ses.setPermissionRequestHandler((wc, permission, callback, details) => {
      const origin = (details && (details.requestingUrl || details.securityOrigin)) || wc.getURL();
      // the microphone, for voice chat in games, with "Microphone on game launch" on
      // (sound only: never the camera)
      if (permission === 'media') {
        const types = (details && details.mediaTypes) || [];
        const ok = cfg.mic_on_launch && types.length > 0 && types.every(t => t === 'audio') && isLunaHost(hostOf(origin));
        if (cfg.mic_on_launch) log(`microphone ${ok ? 'allowed' : 'not allowed'} for ${hostOf(origin)} (${types.join(', ') || 'nothing named'})`);
        callback(ok);
        return;
      }
      callback(okPermissions.has(permission) && rules.hostAllowed(origin, allowList));
    });
    ses.on('will-download', event => { event.preventDefault(); log('blocked a download'); });
  } catch (e) { /* ignore */ }
  try { ses.setUserAgent(cleanUserAgent()); } catch (e) { /* ignore */ }
  // open the connections (DNS + secure handshake) now, so the Luna page
  // starts loading faster when it's asked for
  for (const url of warmUp()) {
    try { ses.preconnect({ url, numSockets: 2 }); } catch (e) { /* older Electron: skip */ }
  }
}
// started from the F1 "Amazon Luna Settings" shortcut: show only the settings
const SETTINGS_MODE = process.argv.includes('--luna-settings');

// Exiting: save the sign-in (cookies and site data) to disk, then close at
// once instead of a full, slower browser shutdown. Never waits more than
// 1.5 s for the save.
let exiting = false;
function fastExit(reason) {
  if (exiting) return;
  exiting = true;
  log(`exit requested (${reason})`);
  try { if (mainWin) mainWin.hide(); } catch (e) { /* ignore */ }  // get off the screen right away
  try { flushPlayed(); } catch (e) { /* ignore */ }
  const ses = curSession();
  // Settings > Sign out when closing: forget the Amazon sign-in on the way out
  // (not when only the F1 Settings shortcut was open)
  if (cfg.sign_out_on_exit && !SETTINGS_MODE) {
    log('signing out of Amazon on exit (Settings > Sign out when closing)');
    if (curProfile) profiles.update(curProfile, { xuid: '', age: '' });
    const out = Promise.resolve().then(() => ses.clearStorageData()).then(() => ses.clearCache())
      .catch(e => log(`sign out on exit: ${e.message}`));
    Promise.race([out, new Promise(resolve => setTimeout(resolve, 4000))]).then(() => app.exit(0));
    return;
  }
  const saves = [];
  try { saves.push(ses.cookies.flushStore()); } catch (e) { /* ignore */ }
  try { if (ses.flushStorageData) ses.flushStorageData(); } catch (e) { /* ignore */ }
  const limit = new Promise(resolve => setTimeout(resolve, 1500));
  Promise.race([Promise.allSettled(saves), limit]).then(() => app.exit(0));
}


// The 🎮 emoji as a small picture, so it shows even where no emoji font is
// installed (Batocera). From Google's Noto Color Emoji, Apache License 2.0.
// the app's cloud icon, shown beside the title on the welcome screen
const APP_ICON_PNG = 'data:image/png;base64,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';
const GAMEPAD_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAQ6ElEQVR42u1ae4xcZ3X/nfN9d+7M7Mw+7X17d+048SPGdoqoWv7ATguRpbQG0W6gwU6JU4W2UlupEtBWbcejSqX9o0JqS2hogoMICHYLDaGBqqgCI0oliHiFhNgOXnvtfb8fnse99zunf9yZ8e56ba8fCaD6SHd2Z+7c+b7z/p3zHeAO3aE7dIfu0B36f0t0U8/kcpRb50Y+n1cA+npuOJfL8c9iXQCg9Ra/TUK9LYLZ4P5ubbOaU37ge4d7nchmhmknwEcs/nLapF98/vnPjd6GNXWdZ/TAgQPWZDK/SkSdrOzAZpYEMw1pe25wcHChKoh8Pi+3UwAEQA/90SFfh1NHIXpYVXeqageAFBERAK28/G+Kkw8nEjJ69mwTZzKntLW1VQcGBgQAiGijZkqq8VeJCP39/TwwMCAP/Ma7ckz4sAKJipBEVRcBOg3oNz3lT33lK8/9ZAVfeqsCIFUFHTxo3p5t+FfL9v2xOBRauVapLX7/7q+98Py/X0O5tAG5X7HxQ/2HNrtC4rvM3CsiGsuGUL0qD42ryt/+15e/9E9Vxd2SAKrm9I4H3/mRRML7syAI3IpnCCAwxfwwsbJhSnj+QCaTfUFENhvmrCoygGwiYgfVegAtiutYAskMgZcUygQwgZZKYbk7KAeHxTkCAKcOLoogqhBRVRUwM1tr4Zz7aH3S++DAwIBcz+roGtwz8nl58KGH9gSF8osEeEREzEzWWFgbX8wGhg2YGURU+cswhmGMWWUpqoDq9d2TiFFRKhQAgaCqcC6q/R5B4AQQETgJEAQRyuWyi1xU2Sa/96tf+uLnrxcTriqAAwcO2IMHD8r/fPf7f5nwE3nPWEmlUmyNB2ICE6+ysZjH6osCINEK59U4UXEpur4ASGu8136dCICpfidwFp5xAIBILHwTIXIOYRhIKShTobD0/Nde+I93r9ziemvZq+3h4MGDks/n5fC737OzvqERTKREBBGBisIhXpyZ1xEqAYCp+uYa5m4JrhCAUBi/1DWEX7/rxyACvv7T3fjuxW3wjcIkk0im0pSwtvfAgQN88uTJ6FqKpmv5/iPHHn+AyH6GCC0iAlGlzZua0LelCyqKs+cvYHZuYT0hvD5AhBShM9jaPIW/uP85pFMhoECxZPH3Jw/jzFQHPBtBlZSZwzAMPxIU5v+mEgvWtYIrLEBViYjkyGN/uB3iPsaGN0VRqERElhl93V1obqyPRUfA0nIBzrnXnXkFgUCIxGB/xzmkkyGCsgGgSCUivKl9GKemOmseo6oJa+1fcX3TEBF9qqLUKwSwrupyyDFc9CHredudi4RXhFIiVHzNwbMWnrVxUCLgpqx7g2S1DCtFMBRThXoAgMcOnonj21whA6oEWyaQiggxMwnl3vvYY235fF7XQ4q81vSJSF/73ZFfZuaHnXPqnCMnuiqKrMy91Q8jJ3BOXh/dq2DR78Nscgc84/D9iz345ms7ESkjEoPvDG/D90b7EHkMVaDIFqExrFHkbMLfasX8+dWC4Cqd9ff3m8HBQXf0/Y+f8JOp95dKBdfeutl0drTFXyQgU5eGMXEwFhEsXypARBFFEYZHxrCwsARmgt6u0kQV51p+E8PN74DCoKn4Ku4Z/wwybhLdzfOAAufmNsEp4x1Tw3jLzASWrYevdPThVLYJSaiKasiie5555skza9OiXRP43MPHjvWS8uEgKGsymeS7t/UinU5BNM5MIpfzOjOjqbEeqoAxBkyMl5ZOV3I93bLPGy1jPnkPhpsfgBKDJcRk5l40NLwV6ekv4tRUF0gF7AkOTF/Aw+dPwVMFxKG1VMQ/3rMPk8m0JK2XCILw9wB8+Kou8MorrxAAsCbemfD9ZhERw0xkGE4cnHNwTq6Av84JROKLDYOZb5P2CayCsm2EIw9GAhApjCjKthHKFkmvBD8RwMJh1+IcWBXL1kPB87E5KKLn0jIiIlJxAOuD7zp6tCWfz8tKLFITwODgYEVt+lsiTomISqUyRkYnEAQhoigGGiuZU1VEUSycQqGIsfFJRFF0k7l+LfsKRx6y5WGkwmkEJoWIUyAA9aXTsJGDCTx4ZQsVg2k/BSMCVoUngpAYswkfrCAnAih2pEzirQBw/PhxWuUCVb84cuTYHiLsdc4REUEBDJ2/iJGxCUAVvu9j987tSKeSIAIWlwp4+Sdn4CS2jCAIa8yvFILeoEnUniUP6WgKu8efwkjDQZS9RnQsfAudCy9itpEw1DUNCNAzmsW3m7rQXVjCvvkZOBC+2tGLoUw9PBUSVbGeZyXUBwB8+QocUDV/ePat1tjGKIqEiGrWUS4HMRNEuGwCMT4vlQM451ZlhgpoqkUBZr6hwBhFDgqt1QWNxdfQUDoLgYUnZcxlCN94ywTm6gOAFCMdl2C/04knkvuxKSzAgTCRTMPoijSlCgb2ve9976vP5/OL1WqRV5g/SPG29YJXlTkRhaiCmcB8WdNUKYSq2m7IZrC1txv3bN+Kni1dSKdSiKLrp0iRGE+0bm5GT3cnero70dJUDwcPogZECkgKF9oLWMiESJYNkmWLufoQY21LICVcTGcwnqqDpwqqCZFIRADQHnh12ytWT1ULIAB69OjRFiLaV5EYrSeEMAwxNj4JY9qhohibmIqDXwUhOefQ29OFXTu2o6E+C2aDKIowN7+AV0+/hosj4+vCZqo8m8nUYdeOu9DR3oZUMgkiwtLSMi6MjODV00MoRyEsFFzTrEJBgAKkBAKQEAHplUk/BmvUBKe7AXyv5gK5XI7y+byqTW1XoJtErhrEiAgXRycwPTtfM3+qMB85h+7ONty39140NDTA930wM0QEfsJHpi6NIIgwPjlVQ4+XNS/wPA9v3r8HXZ3tSCZT8DwPAJBKpZDN1kGV8OOfnIIzii3jdTjXvYzJljJAivaJFLaM1cExruZmBMBZzzNAcO+6tQAJ7TWeaax2W65lqsViaVWwElV41uLubX3IZrPIZOrAbKpSjwWhgrvv6sP0zOwq5qva7+xoQ+vmFvh+EnV1dbX7nudBVbGtrwcjI2OYmV9AtuDh4HfaMdJaAIHQOZFCqmzhzNVbLapKUEBU9x46dMjP5/NlAFRDRcr6FmKGbiBkrwx4RICKIJ3yka3PIuF5IDIrmiAKz/PgeR4a6rPw/QRif7yM9IgIrZuaYY1FOp2uNT2qAvR9H8mkj8bGBkAVwkC6aLFzqAE7huqRLlk4vnafKY4DDkTY2dLS07wKBxw+fCwL8D66scblmgXMTWG/6mLGWGBljbGO0I3hy/ZsFIEnCDyJNb+BLYooCNwrSdpSDYQMAPX16CVoj8T5nG8QqoOIUSqVUCgWEYQBVGUVHoiiCEEQoFQqIQpXAyWiOJ0uLS3BOYdyubwqUFafD8MQS8uFFd3a1ddGd8tsDDvZU03/8Uq+3WqM2exElG4CxjETykGACxfHEAQBFhYWEEURACAMQywsLEBEcP7CKMpheEUmICIMj4yiWCxheXkZxWKxdm95+RIKhQJmZmYxOzdXiy03SWKtgSGzHwB2795NcRAU2mV9ayTu+pobL9hiXz17bhh1dSn09fYgiiIwE5wThGGIU2fO4qdD52HNagZUFcYYLCwu4wcvvYL79u6Gcw6eF2foIAgwv7CAH79yGuVyCGtvSQCVBKo7AKXjx+FsBdPtkjjo0M3i+NhUHX740quYmp5D66YWGGsQRSHGxqcxPj55Vf9WVVhjMHxhBMvLl9DT3YFsNgNRxdzcAoYvjOBSoQhj+FaYh6py5Byg2Hb06CPNRJ+esblcjs9emLgXGqM8cwuFTNWfhy+MYPjiaPUMBYDWegjX7PpYg7n5BczNzcNW0l9cXPFt6TsSEYtzSoZ7KJHaDGCGh4bGO6DaTgRsam6sQdxbal9ZC8vxpq1lWGs3HFCNMTDWohKQYa2FWWdPqlidTm8gDnjWJsKibK/UKdwpThpTvo/eLZ3kWa/S/Lgp/3KqKiIioirx/1p5qxu6qrTq/Yr7gIpqbC312bqbVhIbvhcAbMToIlAmmUxq0k/QTR6zKxGRMcbobRpauOrvqCAMI014Pu3dsxOjY5M4e+4CDPMN7ZxAOwDAkmqf5/uUrktFXiJhmc2Kg5gNBRZlY0icFETCHyloFJB5YprSmMqGeXpDtgkBCWWIqEGgDk4yxLYBgEfQTQBaFdRure24VCzp2MQUbevdgmKpjNGxyRvKEMS4GwAsE3oIgJ9IkGcN2MRF5KrS/9qaB1QDJTxiXOmFvr6+KJ/PR7f7TKS/v99LtLcnZXqpjZL+cWPMwxdHxqW9dRNv39qDxcVlXCoUrmsJqkpxWY+m/v7HG6wTt8XCg5/wyBoLQ9WSagOny6qS8H0TlIOnnj3xL19Yu1C19VRruGyAdu/erZdHX45XcZ4ODg4GAAIAi4888oEPKblfCUS2Tk3Pydbebu7d0olXzwzVGinXPvIXEKgxmbRtFkSbiAgJL47UiURi437PzEEQLArh47lcjr/xDfDJk3m35oDzFih/RW9iYGCAH3rooZFHHv3AF4jpg9Ozc9rd2Ya21hZMz85jcmr6mimzmqoBbYhs2Goh6GAiEDEpFMmUv2Hft9ZyGAQvPPvMJ16udShu/7DSqt97+eWXFQBCh3+zKo8tLi43Ly4ta3NTI/V2t2NxaRHlcnitxiypqjJz2tOomdeeDtVnM1cvgVdsipkocq4kop8DUD12et0ntSrlO0XF2R8Q87dFFGMT0yri0NCQRVdHe9xa2wAoInAzr8w9IorGhizSqWSt0bmyURlVgEcsQUPi5EXfuq+vGFV7Q6i/v58HBwcDUnkOUMzOLVCpFAAgdHe2o6kxi8jJddvzotrCxPFhZ9zzVyQTPu7a1ovKqAmk0iJrb21BV/vmmvhEVUH62U9+8pNLb5T2L59hxENXkrbPQfV0EISYnJ4RQOF5Bvds70PCsxC5/pYYIHJOUCwUK4ecDm2bW3Df3l3Y2rcF27f1Yv+bdmLfnp1obmqCqIo1BiLyozLXff5nMxdImsvl+NMf+9iMAE8zE42OTWmxWIYqkM1kcNe2nutuTIGQQTwGqE5MzmgURbDWQERQn81gW283+nq6sKmlCcVSCRfHxisRlEhEPz749EdnK01VeaNFkM/nVVWpvDz7ZBRFPyqVA/Pa0LBEzoGJ0NXehs7O1vWAkcaNWBcw4SWzb/+btyQSifuXL11ypXKZ6upS5Pt+XJRUys+lpUs4c/Y8Zmfno2QyaaIo+Nb02Pk/PXPmNbn//pP4GRI/8cQTpb379p8D8XsKhaJdXrrk/KTPnmcRhHFLfk32cn4yaZwLv15cmvs7OnLk91vh6X8mff++YrEovp+oNi+JiVAOQszNL2g5CDXheUZFJyNxDzx74skfAjkG3njtrzfOc+TRx//YsPkHVVhAxU8kELkIUbR6esXzEizizpFzD5448WSM0I4+9ge7SOWfQfxrhhlRFCEeilAwUWUcjhFG0QREP/DpZ5780o2OpL4BA9965NHHHyXivzZs+lYN2dHlhg0gJ0WDP3n2xIkf5nI5pirmPXzsWLZR/d9WdQ8S824C2gAygEYichGMk47lxGefeuoHFezw88D82qN+OXbsWG+o9neU6G2k6AEoQZBlJT6jKv9dXsbnBwc/sVBVIK0dMO7v7zeJhoYOG3ImYmIrKmXr5j739NMTKxfCzyGt4SOVSjU3MzOXTBDseLp7Kl9x16tZ73XG4ZVuZhz952lsvvI5XW9OkKonp+tUZb9IRKqK48ePU2X/eCPB2h26Q3foDt2hO/QLQP8Hm/81y6niweQAAAAASUVORK5CYII=';

// The app's own screens (the start screen and "can't connect") are written
// to files in the profile folder and loaded from there, so the controller
// helper (preload.js) always runs on them. Each also has its own small
// script for keyboard and mouse, so those work even without the helper.
// The screens answer by going to https://luna.invalid/<action>, which
// never leaves the app: main.js catches it (see handleAction).
const ACTION_PREFIX = 'https://luna.invalid/';

// a gear, drawn as a picture (Batocera's fonts may not have a gear symbol)
const GEAR_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6a.5.5 0 0 0 .1-.6l-2-3.5a.5.5 0 0 0-.6-.2l-2.5 1a7.4 7.4 0 0 0-1.7-1L14.4 2.4a.5.5 0 0 0-.5-.4h-4a.5.5 0 0 0-.5.4L9 5.1a7.4 7.4 0 0 0-1.7 1l-2.5-1a.5.5 0 0 0-.6.2l-2 3.5a.5.5 0 0 0 .1.6L4.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6a.5.5 0 0 0-.1.6l2 3.5a.5.5 0 0 0 .6.2l2.5-1a7.4 7.4 0 0 0 1.7 1l.4 2.7a.5.5 0 0 0 .5.4h4a.5.5 0 0 0 .5-.4l.4-2.7a7.4 7.4 0 0 0 1.7-1l2.5 1a.5.5 0 0 0 .6-.2l2-3.5a.5.5 0 0 0-.1-.6zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/></svg>';

// Amazon Luna's sites: one per country where its cloud games are offered.
// The code is the region's language and country (for its name in Settings);
// the address is that country's Luna site. Austria and Luxembourg use the
// German site, as Amazon does. Names are made from the codes in each
// language (tools/gen-i18n.js).
const REGIONS = [
  ['en-us', 'luna.amazon.com'], ['en-ca', 'luna.amazon.ca'], ['en-gb', 'luna.amazon.co.uk'],
  ['de-de', 'luna.amazon.de'], ['fr-fr', 'luna.amazon.fr'], ['it-it', 'luna.amazon.it'],
  ['es-es', 'luna.amazon.es'], ['nl-nl', 'luna.amazon.nl'], ['pl-pl', 'luna.amazon.pl'],
  ['nl-be', 'luna.amazon.com.be'], ['pt-pt', 'luna.amazon.pt'], ['sv-se', 'luna.amazon.se']
];
const REGION_URL = code => `https://${(REGIONS.find(r => r[0] === code) || REGIONS[0])[1]}/`;
function currentRegion() {
  let host = '';
  try { host = new URL(cfg.start_url).hostname.toLowerCase(); } catch (e) { return 'custom'; }
  const r = REGIONS.find(x => x[1] === host);
  return r ? r[0] : 'custom';
}
// the Luna site in use (for game addresses and the game list)
function lunaHost() {
  try { const h = new URL(cfg.start_url).hostname.toLowerCase(); if (isLunaHost(h)) return h; } catch (e) { /* not an address */ }
  return 'luna.amazon.com';
}
function welcomeShown() { return cfg.show_exit_tip && !fs.existsSync(TIP_HIDDEN); }

// Shown each time the app opens, before Luna: how to exit, and it waits
// for a choice so that press can't also click the Luna page.
function introHtml() {
  const L = cfg.language;
  const T = (k, v) => i18n.t(L, k, v);
  const holdText = i18n.secs(L, cfg.exit_hold_seconds);
  return `<!doctype html>
<html lang="${L}"><head><meta charset="utf-8"><title>Amazon Luna</title>
<style>
  ${i18n.FONT_CSS}
  html,body{margin:0;height:100%;background:rgba(0,0,0,.62);color:#eee;font-family:${i18n.FONT_STACK}}
  body{display:flex;align-items:center;justify-content:center}
  @keyframes pop{from{opacity:0;transform:scale(.94)}to{opacity:1;transform:none}}
  .card{animation:pop .22s ease-out}
  .card{background:#1a1a1a;border:2px solid #2d2d2d;border-top:6px solid #9146ff;border-radius:14px;
        padding:44px 64px;max-width:860px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.6)}
  h1{margin:0 0 6px;font-size:40px;font-weight:600;color:#fff;display:flex;align-items:center;justify-content:center;gap:16px}
  h1 img{height:64px;width:auto}
  .sub{margin:0 0 16px;font-size:20px;color:#9a9a9a}
  .best{display:inline-flex;align-items:center;gap:10px;margin:0 0 14px;padding:6px 20px 6px 14px;border-radius:999px;
        background:#221735;border:2px solid #9146ff;color:#c4a6ff;font-size:19px;font-weight:600}
  .how{font-size:30px;line-height:1.5;margin:0 0 10px}
  .keys{display:flex;align-items:center;justify-content:center;gap:18px;margin:24px 0 10px;font-size:26px}
  .btn{display:inline-flex;align-items:center;justify-content:center;min-width:72px;height:72px;border-radius:36px;
       box-sizing:border-box;padding:0 6px;background:#2b2b2b;border:3px solid #6b6b6b;font-size:34px;color:#fff}
  .btn.word{font-size:17px;font-weight:700;letter-spacing:1px;padding:0 18px}
  .lbl{display:block;font-size:18px;color:#bdbdbd;margin-top:8px}
  .plus{font-size:40px;color:#8a8a8a;margin-bottom:26px}
  .dev{font-size:18px;color:#b18cff;margin:6px 0 0;min-height:24px}
  .kb{font-size:22px;color:#cfcfcf;margin:18px 0 0}
  .kb kbd,.set kbd{display:inline-block;background:#2b2b2b;border:2px solid #6b6b6b;border-bottom-width:4px;border-radius:7px;
          padding:2px 12px;font:600 20px sans-serif;color:#fff}
  .note{font-size:20px;color:#9a9a9a;margin:0 0 26px}
  .row{display:flex;gap:22px;justify-content:center;flex-wrap:wrap}
  button{display:inline-flex;align-items:center;gap:14px;border-radius:10px;padding:16px 34px;font-size:24px;
         font-weight:600;cursor:pointer;font-family:inherit;outline:none}
  .go{background:#9146ff;color:#fff;border:3px solid #9146ff}
  .never{background:#262626;color:#ddd;border:3px solid #555}
  .settings{background:#262626;color:#ddd;border:3px solid #555}
  .settings svg{width:30px;height:30px}
  button:focus{outline:4px solid #fff;outline-offset:4px}
  .m{display:inline-flex;align-items:center;justify-content:center;min-width:38px;height:38px;border-radius:19px;
      box-sizing:border-box;padding:0 4px;background:#2b2b2b;border:2px solid #8a8a8a;color:#fff;font-size:12px;font-weight:700;letter-spacing:.5px}
  .m svg{width:24px;height:24px}
  .m.word{padding:0 10px}
  .set{font-size:20px;color:#cfcfcf;margin:6px 0 28px}
  .set b{color:#fff}
  .a,.y{display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:50%;
        font-weight:700;font-size:20px}
  .a{background:#fff;color:#9146ff}
  .y{background:#d9a400;color:#1a1a1a}
  .hint{margin:22px 0 0;font-size:17px;color:#7d7d7d}
</style></head><body>
<div class="card" role="dialog" aria-labelledby="t">
  <h1 id="t"><img src="${APP_ICON_PNG}" alt="">Amazon Luna</h1>
  <p class="sub">${T('before')}</p>
  <p class="best"><img src="${GAMEPAD_PNG}" alt="" width="30" height="30"> ${T('best')}</p>
  <p class="note">${T('anytime')}</p>
  <p class="how"><b>${T('hold')}</b></p>
  <div class="keys">
    <div><span class="btn word" id="k1g">SELECT</span><span class="lbl" id="k1l">Select</span></div>
    <div class="plus">+</div>
    <div><span class="btn word" id="k2g">START</span><span class="lbl" id="k2l">Start</span></div>
  </div>
  <p class="dev" id="dev">${T('pressAny')}</p>
  <p class="how">${T('toExit', { t: `<b>${holdText}</b>` })}</p>
  <p class="kb">${T('kbExit', { esc: '<kbd>Esc</kbd>', t: holdText })}</p>
  <p class="set">${T('back', { menu: '<b id="kml2">Start</b>', s: '<kbd>S</kbd>', t: i18n.secs(L, 1) })}</p>
  <div class="row">
    <button class="go" id="go" autofocus><span class="a" id="ka">A</span> ${T('go')}</button>
    <button class="never" id="never"><span class="y" id="ky">Y</span> ${T('never')}</button>
    <button class="settings" id="settings"><span class="m word" id="km">SELECT</span> ${T('settings')}</button>
  </div>
  <p class="hint" id="hint">${T('hintPad', { a: 'A', y: 'Y', menu: 'Select' })}</p>
</div>
<script>
// keyboard (including controllers Batocera maps to keys) and mouse
(function () {
  var go = document.getElementById('go'), never = document.getElementById('never'), settings = document.getElementById('settings');
  var buttons = [go, never, settings], sent = false;
  function act(path) {
    if (sent) return;
    sent = true; setTimeout(function () { sent = false; }, 3000);
    location.href = '${ACTION_PREFIX}' + path;
  }
  function choose(b) {
    if (b === never) act('continue?never=1');
    else if (b === settings) act('settings');
    else act('continue');
  }
  function focused() {
    if (buttons.indexOf(document.activeElement) < 0) go.focus();
    return document.activeElement;
  }
  function move(step) {
    var i = buttons.indexOf(focused());
    buttons[(i + step + buttons.length) % buttons.length].focus();
  }
  buttons.forEach(function (b) { b.addEventListener('click', function (e) { e.preventDefault(); choose(b); }); });
  window.addEventListener('keydown', function (e) {
    var k = e.key;
    if (k === 'ArrowLeft' || k === 'ArrowUp' || (k === 'Tab' && e.shiftKey)) { e.preventDefault(); move(-1); }
    else if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'Tab') { e.preventDefault(); move(1); }
    else if (k === 'Enter' || k === 'NumpadEnter' || k === ' ' || k === 'Spacebar' || k === 'x' || k === 'X') {
      e.preventDefault(); choose(focused());
    } else if (k === 'y' || k === 'Y') { e.preventDefault(); choose(never); }
    // Backspace (or S) on a keyboard: Settings, like Select on a controller
    else if (k === 'Backspace' || k === 's' || k === 'S') { e.preventDefault(); choose(settings); }
  });
  window.addEventListener('load', function () { window.focus(); go.focus(); });
  go.focus();
})();
</script>
</body></html>`;
}

// The intro video. It covers the window while Luna loads underneath. A, B,
// Menu, Enter or Space skip to its last frame (the logo).
function videoHtml() {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Amazon Luna</title>
<style>
  html,body{margin:0;height:100%;background:#000;overflow:hidden;cursor:none}
  video{width:100%;height:100%;object-fit:cover;display:block}
  img{position:fixed;inset:0;width:100%;height:100%;object-fit:cover;display:block}
</style></head><body>
<video id="v" autoplay${cfg.intro_muted ? ' muted' : ''} playsinline preload="auto"></video>
<script>
(function () {
  var v = document.getElementById('v'), done = false;
  // WebM first, the MP4 if that can't play (each one is tried before giving up)
  var files = ${JSON.stringify([INTRO_WEBM, INTRO_VIDEO].filter(f => fs.existsSync(f)).map(f => pathToFileURL(f).href))}, fi = 0, tried = [];
  v.src = files[0] || '';
  // Settings > Intro video sound
  v.muted = ${cfg.intro_muted ? 'true' : 'false'};
  v.volume = ${(cfg.intro_volume / 100).toFixed(2)};
  // why it ended goes in the log
  function finish(why) {
    if (done) return;
    done = true;
    location.href = '${ACTION_PREFIX}intro-done?why=' + encodeURIComponent(why || 'ended') + '&at=' + (v.currentTime || 0).toFixed(1);
  }
  function skip(why) {
    if (done) return;
    try { if (window.__introAudio) window.__introAudio.pause(); } catch (e) {}
    try { if (window.__introCtx) window.__introCtx.close(); } catch (e) {}
    try { if (!pic && v.duration) { v.pause(); v.currentTime = Math.max(0, v.duration - 0.05); } } catch (e) {}
    finish(why);
  }
  v.addEventListener('ended', function () { finish('played to the end'); });
  v.addEventListener('error', function () {
    tried.push((files[fi] || 'no file').split('/').pop() + ': ' + (v.error ? v.error.code + ' ' + (v.error.message || '') : '?'));
    if (++fi < files.length) { v.src = files[fi]; var r = v.play(); if (r && r.catch) r.catch(function () {}); return; }
    pictures();
  });
  // no video could be decoded: the animated picture, with the soundtrack
  var PIC = ${JSON.stringify(fs.existsSync(INTRO_FRAMES) ? pathToFileURL(INTRO_FRAMES).href : '')}, pic = false;
  function pictures() {
    if (!PIC) { finish('playback error (' + tried.join('; ') + ')'); return; }
    pic = true;
    v.removeAttribute('src'); v.style.display = 'none';
    var img = document.createElement('img');
    img.onerror = function () { finish('playback error (' + tried.join('; ') + '); the picture version failed too'); };
    img.onload = function () {
      // the soundtrack: decoded here and played straight to the speakers (Web
      // Audio, the way game sound goes), not through the media player, which
      // can fail the same way the video does; the media player only as a backup
      var sound = 'none';
      function viaPlayer(why) {
        var a = new Audio(), aud = ${JSON.stringify(fs.existsSync(INTRO_AUDIO) ? [pathToFileURL(INTRO_AUDIO).href] : [])}.concat(files), ai = 0;
        a.muted = v.muted; a.volume = v.volume;
        a.onerror = function () { if (++ai < aud.length) { a.src = aud[ai]; var r2 = a.play(); if (r2 && r2.catch) r2.catch(function () {}); } else sound = 'failed (' + why + '; player ' + ((a.error && a.error.code) || '?') + ')'; };
        a.src = aud[0] || '';
        var q = a.play(); if (q && q.catch) q.catch(function (e) { sound = 'failed (' + why + '; player ' + (e && e.name) + ')'; });
        window.__introAudio = a;
        sound = 'media player (' + why + ')';
      }
      var B64 = ${JSON.stringify(fs.existsSync(INTRO_AUDIO) ? fs.readFileSync(INTRO_AUDIO).toString('base64') : '')};
      if (v.muted) sound = 'muted';
      else if (!B64 || !(window.AudioContext || window.webkitAudioContext)) viaPlayer('no Web Audio');
      else {
        try {
          var ctx = new (window.AudioContext || window.webkitAudioContext)();
          window.__introCtx = ctx;
          var bin = atob(B64), buf = new Uint8Array(bin.length);
          for (var bi = 0; bi < bin.length; bi++) buf[bi] = bin.charCodeAt(bi);
          ctx.decodeAudioData(buf.buffer).then(function (ab) {
            var src = ctx.createBufferSource(), g = ctx.createGain();
            src.buffer = ab; g.gain.value = v.volume;
            src.connect(g); g.connect(ctx.destination);
            if (ctx.resume) ctx.resume();
            src.start();
            sound = 'Web Audio';
          }).catch(function (e) { viaPlayer('Web Audio: ' + (e && e.name)); });
        } catch (e) { viaPlayer('Web Audio: ' + (e && e.name)); }
      }
      setTimeout(function () {
        var c = window.__introCtx, a = window.__introAudio;
        var how = sound === 'Web Audio' && c ? 'Web Audio, ' + c.state + ', ' + c.currentTime.toFixed(1) + ' s played'
          : a ? sound + ', at ' + (a.currentTime || 0).toFixed(1) + ' s' : sound;
        finish('shown as pictures, the video could not be decoded (' + tried.join('; ') + '); sound: ' + how);
      }, 5200);
    };
    img.src = PIC;
    document.body.appendChild(img);
  }
  setTimeout(function () { finish('still not finished after 25 s'); }, 25000);           // never get stuck on the video
  // if playing with sound is refused, play it muted rather than skip it
  var p = v.play();
  // (a file that can't be played at all is left to the error handler: it tries the next one)
  if (p && p.catch) p.catch(function (e0) {
    if (pic || (e0 && e0.name !== 'NotAllowedError')) return;
    v.muted = true; var q = v.play();
    if (q && q.catch) q.catch(function (e) { if (!pic && e && e.name === 'NotAllowedError') finish('playing refused: ' + e.name); });
  });
  window.addEventListener('keydown', function (e) {
    var k = e.key;
    if (k === 'Enter' || k === 'NumpadEnter' || k === ' ' || k === 'x' || k === 'X' || k === 'F10') { e.preventDefault(); skip('skipped (' + (e.isTrusted ? 'key ' : 'controller, ') + k + ')'); }
  });
  window.addEventListener('mousedown', function () { skip('skipped (mouse)'); });
  window.addEventListener('load', function () { window.focus(); });
})();
</script>
</body></html>`;
}

function errorHtml() {
  const L = cfg.language;
  const T = k => i18n.t(L, k);
  return `<!doctype html>
<html lang="${L}"><head><meta charset="utf-8"><title>Amazon Luna</title>
<style>
  ${i18n.FONT_CSS}
  html,body{margin:0;height:100%;background:#0e0e0e;color:#eee;font-family:${i18n.FONT_STACK}}
  body{display:flex;align-items:center;justify-content:center;text-align:center}
  h1{color:#b18cff;font-weight:600;margin:0 0 16px}
  p{font-size:22px;line-height:1.5;margin:6px}
  button{margin-top:22px;background:#9146ff;color:#fff;border:3px solid #9146ff;border-radius:10px;padding:14px 40px;
         font-size:24px;font-weight:600;cursor:pointer;font-family:inherit;outline:none}
  button:focus{outline:4px solid #fff;outline-offset:4px}
</style></head><body><div>
  <h1>${T('errTitle')}</h1>
  <p>${T('errNet')}</p>
  <p>${T('errRetry')}</p>
  <p>${T('errExit')}</p>
  <button id="retry" autofocus>${T('errBtn')}</button>
</div>
<script>
(function () {
  var b = document.getElementById('retry');
  function retry() { location.href = '${ACTION_PREFIX}retry'; }
  b.addEventListener('click', function (e) { e.preventDefault(); retry(); });
  window.addEventListener('keydown', function (e) {
    var k = e.key;
    if (k === 'Enter' || k === 'NumpadEnter' || k === ' ' || k === 'x' || k === 'X') { e.preventDefault(); retry(); }
  });
  window.addEventListener('load', function () { window.focus(); b.focus(); });
})();
</script>
</body></html>`;
}

// ---------- settings screen ----------
// Opened from the welcome screen (returns there) or the F1 > Applications
// "Amazon Luna Settings" shortcut (closes the app afterwards).
function settingsHtml() {
  const L = cfg.language;
  const custom = currentRegion() === 'custom';
  // the text for every language, so the screen changes language as you pick one
  const KEYS = ['settings', 'region', 'regionHelp', 'of', 'language', 'languageHelp', 'volume', 'volumeHelp', 'keys', 'keysHelp',
    'on', 'off', 'reloadT', 'reloadHelp', 'reloadBtn', 'save', 'cancel', 'sHint', 'sHintR', 'custom', 'auto',
    'intro', 'introHelp', 'introAlways', 'introDaily', 'introOff', 'signOutT', 'signOutHelp', 'signOutBtn', 'signOutConfirm',
    'winT', 'winHelp', 'version', 'resT', 'resAuto', 'res1080', 'resHq', 'res1440', 'resHelpAuto', 'resHelp1080', 'resHelpHq', 'resHelp1440',
    'secAcct', 'secGen', 'secStream', 'secPic', 'secPad', 'secBato', 'secHelp', 'autoH',
    'gpuT', 'gpuHelp', 'shT', 'shHelp', 'clT', 'clHelp', 'ctT', 'saT', 'brT', 'picHelp', 'shLow', 'shMed', 'shHigh', 'statsT', 'statsHelp', 'vibT', 'vibHelp', 'introSound', 'introSoundHelp', 'muted',
    'updT', 'updHelp', 'updBtn', 'updChecking', 'updNone', 'updGetting', 'updDone', 'updFail',
    'ctrlT', 'ctrlHelp', 'ctrlBtn', 'ctrlBack', 'soeT', 'soeHelp', 'profT', 'profHelp', 'profHelpNone', 'profBtn', 'glT', 'glOff', 'glAll', 'glFree', 'glPick', 'glHelpOff', 'glHelpAll', 'glHelpFree', 'glHelpPick', 'glCount', 'gpT', 'gpOnly', 'glBusy', 'g3dT', 'g3dHelp', 'logsT', 'logsHelp', 'logsBtn', 'logsBusy', 'logsDone', 'logsFail', 'cacheT', 'cacheHelp', 'cacheBtn', 'cacheBusy', 'cacheDone',
    'unlockT', 'unlockHelp', 'unlockEu', 'boostT', 'boostHelp', 'socialT', 'socialHelp', 'ipv6T', 'ipv6Help', 'micT', 'micHelp', 'waitT', 'waitHelp', 'touchT', 'touchHelp',
    'secDash', 'upT', 'upHelp', 'utT', 'utHelp', 'utScreen', 'usT', 'usHelp', 'cleanT', 'cleanHelp', 'steadyT', 'steadyHelp', 'pgT', 'pgHelp', 'splitT', 'splitHelp', 'splitN', 'remT', 'remHelp', 'replayT', 'replayHelp', 'aliveT', 'aliveHelp', 'reconT', 'reconHelp',
    'netT', 'netHelp', 'netBtn', 'netBusy', 'netResult', 'netFail', 'battT', 'battHelp', 'battNone', 'splashT', 'splashHelp', 'fbT', 'fbHelp', 'animT', 'animHelp', 'anaT', 'anaHelp',
    'sHintSec', 'resetQ', 'resetDone', 'resetNone', 'lowT', 'lowHelp', 'lowBtn', 'lowDone',
    'bkT', 'bkHelp', 'bkBtn', 'bkBusy', 'bkDone', 'bkFail', 'rsT', 'rsHelp', 'rsNone', 'rsBtn', 'rsConfirm', 'rsBusy', 'rsDone', 'rsFail',
    'dnavT', 'dnavHelp',
    'c1a', 'c1b', 'c2a', 'c2b', 'c3a', 'c3b', 'c4a', 'c4b', 'c5a', 'c5b', 'c6a', 'c6b', 'c7a', 'c7b', 'c8a', 'c8b', 'c9a', 'c9b', 'c10a', 'c10b', 'c11a', 'c11b'];
  const T = {};
  for (const [code] of i18n.LANGS) {
    T[code] = Object.fromEntries(KEYS.map(k => [k, i18n.t(code, k)]));
    // how long to hold, for the Controls list
    T[code]._t = i18n.secs(code, cfg.exit_hold_seconds);
    T[code]._t1 = i18n.secs(code, 1);
  }
  const state = {
    codes: i18n.REGION_CODES, names: i18n.REGION_NAMES, custom: custom ? cfg.start_url : null,
    region: currentRegion(), langs: [['auto', '']].concat(i18n.LANGS), choice: cfg.languageChoice,
    detected: batoceraLanguage(), T, version: VERSION, hippos: ON_HIPPOS,
    volume: cfg.volume, vmute: cfg.muted, soe: cfg.sign_out_on_exit, highlight: cfg.keyboard_highlight, intro: cfg.introMode, windows: cfg.stream_as_windows,
    res: cfg.stream_resolution, sharpen: cfg.video_sharpen, clarity: cfg.clarity_boost, stats: cfg.stream_stats, vib: cfg.vibration, gpu: cfg.gpu_acceleration,
    pic: { ct: cfg.video_contrast, sa: cfg.video_saturation, br: cfg.video_brightness },
    unlock: cfg.region_unlock, unlocks: UNLOCK_CODES, boost: cfg.audio_boost, social: cfg.no_social, ipv6: cfg.prefer_ipv6, mic: cfg.mic_on_launch, wait: cfg.wait_time, touch: cfg.touch_controller,
    x64: X64, up: cfg.upscale_4k, ut: cfg.upscale_target, us: cfg.upscale_sharp, clean: cfg.video_cleanup, steady: cfg.stream_steady, pg: cfg.picture_per_game, split: cfg.split_players,
    rem: cfg.split_remember, replay: cfg.replay, alive: cfg.keep_alive, recon: cfg.auto_reconnect, batt: batteries(), net: null, splash: cfg.skip_splash, fb: cfg.no_feedback, anim: cfg.reduce_anim, ana: cfg.no_analytics,
    ivol: cfg.intro_volume, imute: cfg.intro_muted,
    engine: process.versions.electron, appv: VERSION, upd,
    glist: cfg.game_list, g3d: !!cfg.game_list_3d, glCount: glState().mode === cfg.game_list ? (glState().count || 0) : 0, glBusy: !!glRun, glPct,
    game: pageGame(), gpicked: !!(pageGame() && pickedGames().some(g => g.id === pageGame().id)),
    dnav: cfg.dashboard_nav,
    reload: !SETTINGS_MODE,  // Reload dashboard only when the dashboard is open (not from the F1 shortcut)
    user: PROFILES_ON && curProfile ? profileName(curProfile) : '',
    backup: newestBackup()
  };
  const ICON_RELOAD = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.75 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>';
  const ICON_PAD = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7.5 6h9a5.5 5.5 0 0 1 5.3 7l-1.2 4.3a2.4 2.4 0 0 1-4.1 1L14.3 16H9.7l-2.2 2.3a2.4 2.4 0 0 1-4.1-1L2.2 13A5.5 5.5 0 0 1 7.5 6zM7 9v1.5H5.5v2H7V14h2v-1.5h1.5v-2H9V9H7zm8.5.2a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2zm2 2.3a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2z"/></svg>';
  const ICON_UPDATE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M11 4h2v9.2l3.6-3.6L18 11l-6 6-6-6 1.4-1.4 3.6 3.6V4zM5 18h14v2H5z"/></svg>';
  const ICON_LOGS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm7 1.5V9h5.5L13 3.5zM7 12v2h10v-2H7zm0 4v2h7v-2H7z"/></svg>';
  const ICON_CACHE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9 3h6l1 2h4v2H4V5h4l1-2zM6 8h12l-1 13H7L6 8zm4 3v7h1.5v-7H10zm2.5 0v7H14v-7h-1.5z"/></svg>';
  const ICON_USER = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm0 10c4 0 7 2 7 4.5V20H2v-1.5C2 16 5 14 9 14zm8.5-9.5a3.2 3.2 0 1 1 0 6.4 3.2 3.2 0 0 1 0-6.4zM18 13c3 .3 5 1.9 5 4V19h-5v-.5c0-2-1-3.6-2.6-4.6.8-.6 1.6-.9 2.6-.9z"/></svg>';
  const ICON_LOW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17 4c-6 0-11 3-12 9-.3 1.7 0 3.4.6 4.9L3 20.5 4.5 22l2.6-2.6c1.5.6 3.2.9 4.9.6 6-1 9-6 9-12V4h-4zm-4.6 10.6-1.4-1.4 4.6-4.6 1.4 1.4-4.6 4.6z"/></svg>';
  const ICON_BACKUP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19.4 10A7.5 7.5 0 0 0 5.3 8.1 6 6 0 0 0 6 20h13a5 5 0 0 0 .4-10zM14 13v4h-4v-4H7l5-5 5 5h-3z"/></svg>';
  const ICON_RESTORE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M13 3a9 9 0 0 0-9 9H1l4 4 4-4H6a7 7 0 1 1 2.05 4.95l-1.42 1.42A9 9 0 1 0 13 3zm-1 5v5l4.25 2.52.77-1.28-3.52-2.09V8H12z"/></svg>';
  const ICON_SIGNOUT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M10 17l1.4-1.4L8.8 13H20v-2H8.8l2.6-2.6L10 7l-5 5 5 5zM4 21h8v-2H4V5h8V3H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2z"/></svg>';
  return `<!doctype html>
<html lang="${L}"><head><meta charset="utf-8"><title>Amazon Luna Settings</title>
<style>
  ${i18n.FONT_CSS}
  html,body{margin:0;height:100%;background:rgba(0,0,0,.62);color:#eee;font-family:${i18n.FONT_STACK}}
  body{display:flex;align-items:center;justify-content:center}
  @keyframes pop{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:none}}
  .card{background:#1a1a1a;border:2px solid #2d2d2d;border-top:6px solid #9146ff;border-radius:14px;animation:pop .2s ease-out;
        padding:26px 48px 22px;width:960px;max-height:96vh;box-sizing:border-box;display:flex;flex-direction:column;
        box-shadow:0 20px 60px rgba(0,0,0,.6)}
  .list{overflow-y:auto;scrollbar-width:none;padding:2px}
  .list::-webkit-scrollbar{display:none}
  h1{margin:0 0 2px;font-size:32px;font-weight:600;color:#fff;display:flex;align-items:center;gap:14px}
  h1 svg{width:32px;height:32px;color:#b18cff}
  .sub{margin:0 0 14px;font-size:16px;color:#9a9a9a}
  .row{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:9px 20px;margin:0 0 8px;
       border-radius:10px;background:#222;border:3px solid transparent;cursor:pointer}
  .row.on{border-color:#fff;background:#2a2338}
  .sec{font-size:15px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#a98aff;margin:18px 4px 8px}
  .sec:first-child{margin-top:4px}
  .label{font-size:21px;font-weight:600}
  .help{font-size:14px;color:#9a9a9a;margin-top:2px;font-weight:400}
  .picker{display:flex;align-items:center;gap:12px}
  .arrow{width:38px;height:38px;border-radius:50%;border:2px solid #555;background:#2b2b2b;color:#fff;font-size:18px;
         display:flex;align-items:center;justify-content:center;cursor:pointer;user-select:none;flex:none}
  .value{width:330px;text-align:center;font-size:19px;font-weight:600;color:#c4a6ff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .count{font-size:12px;color:#7d7d7d;text-align:center}
  .bar{width:290px;height:14px;border-radius:7px;background:#3a3a3a;overflow:hidden}
  .bar i{display:block;height:100%;background:#9146ff;transition:width .1s}
  .pct{min-width:60px;text-align:right;font-size:19px;font-weight:600;color:#c4a6ff}
  .chip{display:inline-flex;align-items:center;gap:10px;padding:8px 20px;border-radius:20px;background:#2b2b2b;
        border:2px solid #555;font-size:18px;font-weight:600;color:#fff;white-space:nowrap}
  .chip svg{width:22px;height:22px}
  .row.on .chip{background:#9146ff;border-color:#9146ff}
  .chip.warn{background:#a4262c !important;border-color:#a4262c !important}
  .toggle{width:84px;height:40px;border-radius:20px;background:#444;position:relative;flex:none;transition:background .15s}
  .toggle.dim{opacity:.35}
  .toggle::after{content:'';position:absolute;top:5px;left:5px;width:30px;height:30px;border-radius:50%;background:#ddd;transition:left .15s}
  .toggle.yes{background:#9146ff}
  .toggle.yes::after{left:49px;background:#fff}
  .toggle.mute.yes{background:#a4262c}
  .bar.off i{background:#555}
  .glbar{display:flex;align-items:center;gap:12px;margin-top:6px}
  .glbar .bar{width:320px;height:10px}
  .glpct{font-size:16px;font-weight:700;color:#a98aff;min-width:48px}
  .state{font-size:16px;color:#bdbdbd;min-width:42px;text-align:right}
  .buttons{display:flex;gap:20px;justify-content:center;margin-top:12px}
  button{border-radius:10px;padding:11px 44px;font-size:22px;font-weight:600;cursor:pointer;font-family:inherit;outline:none}
  .save{background:#9146ff;color:#fff;border:3px solid #9146ff}
  .cancel{background:#262626;color:#ddd;border:3px solid #555}
  button.on{outline:4px solid #fff;outline-offset:4px}
  .hint{margin:12px 0 0;font-size:14px;color:#7d7d7d;text-align:center}
  .chip.go{background:#9146ff;border-color:#b18cff}
  .cpanel{display:none;flex-direction:column;min-height:0}
  .card.copen .list,.card.copen .buttons,.card.copen #hint{display:none}
  .card.copen .cpanel{display:flex}
  .clist{overflow-y:auto;scrollbar-width:none}
  .clist::-webkit-scrollbar{display:none}
  .crow{display:flex;gap:26px;align-items:baseline;padding:11px 20px;margin:0 0 8px;border-radius:10px;background:#222}
  .crow .k{width:300px;flex:none;font-size:19px;font-weight:600;color:#fff}
  .crow .d{font-size:17px;color:#cfcfcf;line-height:1.35}
  .cback{display:flex;justify-content:center;margin-top:12px}
  .cback button{background:#262626;color:#ddd;border:3px solid #555}
</style></head><body>
<div class="card" role="dialog" aria-labelledby="t">
  <h1 id="t">${GEAR_SVG} <span id="title" data-k="settings"></span></h1>
  <p class="sub"><span id="crumb">Amazon Luna</span></p>
  <div class="list" id="list">
  <div class="sec" data-k="secAcct"></div>
  <div class="row" id="row-user" style="display:${state.reload ? 'flex' : 'none'}">
    <div><div class="label" data-k="profT"></div><div class="help" id="user-help"></div></div>
    <span class="chip">${ICON_USER} <span data-k="profBtn"></span></span>
  </div>
  <div class="row" id="row-signout">
    <div><div class="label" data-k="signOutT"></div><div class="help" data-k="signOutHelp"></div></div>
    <span class="chip" id="signout-chip">${ICON_SIGNOUT} <span id="signout"></span></span>
  </div>
  <div class="row" id="row-soe">
    <div><div class="label" data-k="soeT"></div><div class="help" data-k="soeHelp"></div></div>
    <div class="picker"><span class="state" id="soe-state"></span><span class="toggle" id="soe"></span></div>
  </div>
  <div class="sec" data-k="secGen"></div>
  <div class="row" id="row-region">
    <div><div class="label" data-k="region"></div><div class="help" data-k="regionHelp"></div></div>
    <div><div class="picker"><span class="arrow" id="prev">&#9664;</span><span class="value" id="region"></span><span class="arrow" id="next">&#9654;</span></div>
    <div class="count" id="count"></div></div>
  </div>
  <div class="row" id="row-unlock">
    <div><div class="label" data-k="unlockT"></div><div class="help" data-k="unlockHelp"></div></div>
    <div class="picker"><span class="arrow" id="ulprev">&#9664;</span><span class="value" id="unlock" style="width:220px"></span><span class="arrow" id="ulnext">&#9654;</span></div>
  </div>
  <div class="row" id="row-language">
    <div><div class="label" data-k="language"></div><div class="help" data-k="languageHelp"></div></div>
    <div><div class="picker"><span class="arrow" id="lprev">&#9664;</span><span class="value" id="language"></span><span class="arrow" id="lnext">&#9654;</span></div>
    <div class="count" id="lcount"></div></div>
  </div>
  <div class="row" id="row-volume">
    <div><div class="label" data-k="volume"></div><div class="help" data-k="volumeHelp"></div></div>
    <div class="picker"><span class="arrow" id="vdown">&minus;</span><span class="bar"><i id="vbar"></i></span><span class="arrow" id="vup">+</span><span class="pct" id="vpct" style="min-width:96px"></span>
    <span class="toggle" id="vmute" style="margin-left:6px"></span></div>
  </div>
  <div class="row" id="row-boost">
    <div><div class="label" data-k="boostT"></div><div class="help" data-k="boostHelp"></div></div>
    <div class="picker"><span class="arrow" id="bodown">&minus;</span><span class="bar" style="width:200px"><i id="bobar"></i></span><span class="arrow" id="boup">+</span><span class="pct" id="bopct" style="min-width:96px"></span></div>
  </div>
  <div class="row" id="row-highlight">
    <div><div class="label" data-k="keys"></div><div class="help" data-k="keysHelp"></div></div>
    <div class="picker"><span class="state" id="highlight-state"></span><span class="toggle" id="highlight"></span></div>
  </div>
  <div class="row" id="row-intro">
    <div><div class="label" data-k="intro"></div><div class="help" data-k="introHelp"></div></div>
    <div class="picker"><span class="arrow" id="iprev">&#9664;</span><span class="value" id="intro" style="width:220px"></span><span class="arrow" id="inext">&#9654;</span></div>
  </div>
  <div class="row" id="row-isound">
    <div><div class="label" data-k="introSound"></div><div class="help" data-k="introSoundHelp"></div></div>
    <div class="picker"><span class="arrow" id="idown">&minus;</span><span class="bar" style="width:200px"><i id="ibar"></i></span><span class="arrow" id="iup">+</span><span class="pct" id="ipct" style="min-width:96px"></span>
    <span class="toggle" id="imute" style="margin-left:6px"></span></div>
  </div>
  <div class="row" id="row-low">
    <div><div class="label" data-k="lowT"></div><div class="help" id="low-help"></div></div>
    <span class="chip">${ICON_LOW} <span data-k="lowBtn"></span></span>
  </div>
  <div class="sec" data-k="secStream"></div>
  <div class="row" id="row-res">
    <div><div class="label" data-k="resT"></div><div class="help" id="res-help"></div></div>
    <div class="picker"><span class="arrow" id="rsprev">&#9664;</span><span class="value" id="res" style="width:220px"></span><span class="arrow" id="rsnext">&#9654;</span></div>
  </div>
  <div class="row" id="row-net">
    <div><div class="label" data-k="netT"></div><div class="help" id="net-help"></div></div>
    <span class="chip" id="net-chip"><span id="net"></span></span>
  </div>
  <div class="row" id="row-windows">
    <div><div class="label" data-k="winT"></div><div class="help" data-k="winHelp"></div></div>
    <div class="picker"><span class="state" id="windows-state"></span><span class="toggle" id="windows"></span></div>
  </div>
  <div class="row" id="row-gpu">
    <div><div class="label" data-k="gpuT"></div><div class="help" data-k="gpuHelp"></div></div>
    <div class="picker"><span class="state" id="gpu-state"></span><span class="toggle" id="gpu"></span></div>
  </div>
  <div class="row" id="row-ipv6">
    <div><div class="label" data-k="ipv6T"></div><div class="help" data-k="ipv6Help"></div></div>
    <div class="picker"><span class="state" id="ipv6-state"></span><span class="toggle" id="ipv6"></span></div>
  </div>
  <div class="row" id="row-mic">
    <div><div class="label" data-k="micT"></div><div class="help" data-k="micHelp"></div></div>
    <div class="picker"><span class="state" id="mic-state"></span><span class="toggle" id="mic"></span></div>
  </div>
  <div class="row" id="row-steady">
    <div><div class="label" data-k="steadyT"></div><div class="help" data-k="steadyHelp"></div></div>
    <div class="picker"><span class="state" id="steady-state"></span><span class="toggle" id="steady"></span></div>
  </div>
  <div class="row" id="row-recon">
    <div><div class="label" data-k="reconT"></div><div class="help" data-k="reconHelp"></div></div>
    <div class="picker"><span class="state" id="recon-state"></span><span class="toggle" id="recon"></span></div>
  </div>
  <div class="row" id="row-alive">
    <div><div class="label" data-k="aliveT"></div><div class="help" data-k="aliveHelp"></div></div>
    <div class="picker"><span class="state" id="alive-state"></span><span class="toggle" id="alive"></span></div>
  </div>
  <div class="row" id="row-replay">
    <div><div class="label" data-k="replayT"></div><div class="help" data-k="replayHelp"></div></div>
    <div class="picker"><span class="state" id="replay-state"></span><span class="toggle" id="replay"></span></div>
  </div>
  <div class="row" id="row-stats">
    <div><div class="label" data-k="statsT"></div><div class="help" data-k="statsHelp"></div></div>
    <div class="picker"><span class="state" id="stats-state"></span><span class="toggle" id="stats"></span></div>
  </div>
  <div class="sec" data-k="secPic"></div>
  <div class="row" id="row-sharpen">
    <div><div class="label" data-k="shT"></div><div class="help" data-k="shHelp"></div></div>
    <div class="picker"><span class="arrow" id="shprev">&#9664;</span><span class="value" id="sharpen" style="width:220px"></span><span class="arrow" id="shnext">&#9654;</span></div>
  </div>
  <div class="row" id="row-up" style="display:${X64 ? 'flex' : 'none'}">
    <div><div class="label" data-k="upT"></div><div class="help" data-k="upHelp"></div></div>
    <div class="picker"><span class="state" id="up-state"></span><span class="toggle" id="up"></span></div>
  </div>
  <div class="row" id="row-ut" style="display:none">
    <div><div class="label" data-k="utT"></div><div class="help" data-k="utHelp"></div></div>
    <div class="picker"><span class="arrow" id="utprev">&#9664;</span><span class="value" id="ut" style="width:220px"></span><span class="arrow" id="utnext">&#9654;</span></div>
  </div>
  <div class="row" id="row-us" style="display:none">
    <div><div class="label" data-k="usT"></div><div class="help" data-k="usHelp"></div></div>
    <div class="picker"><span class="arrow" id="usdown">&minus;</span><span class="bar" style="width:200px"><i id="usbar"></i></span><span class="arrow" id="usup">+</span><span class="pct" id="uspct" style="min-width:96px"></span></div>
  </div>
  <div class="row" id="row-clean">
    <div><div class="label" data-k="cleanT"></div><div class="help" data-k="cleanHelp"></div></div>
    <div class="picker"><span class="state" id="clean-state"></span><span class="toggle" id="clean"></span></div>
  </div>
  <div class="row" id="row-clarity">
    <div><div class="label" data-k="clT"></div><div class="help" data-k="clHelp"></div></div>
    <div class="picker"><span class="state" id="clarity-state"></span><span class="toggle" id="clarity"></span></div>
  </div>
  <div class="row" id="row-ct">
    <div><div class="label" data-k="ctT"></div><div class="help" data-k="picHelp"></div></div>
    <div class="picker"><span class="arrow" id="ctdown">&minus;</span><span class="bar" style="width:200px"><i id="ctbar"></i></span><span class="arrow" id="ctup">+</span><span class="pct" id="ctpct" style="min-width:96px"></span></div>
  </div>
  <div class="row" id="row-sa">
    <div><div class="label" data-k="saT"></div><div class="help" data-k="picHelp"></div></div>
    <div class="picker"><span class="arrow" id="sadown">&minus;</span><span class="bar" style="width:200px"><i id="sabar"></i></span><span class="arrow" id="saup">+</span><span class="pct" id="sapct" style="min-width:96px"></span></div>
  </div>
  <div class="row" id="row-br">
    <div><div class="label" data-k="brT"></div><div class="help" data-k="picHelp"></div></div>
    <div class="picker"><span class="arrow" id="brdown">&minus;</span><span class="bar" style="width:200px"><i id="brbar"></i></span><span class="arrow" id="brup">+</span><span class="pct" id="brpct" style="min-width:96px"></span></div>
  </div>
  <div class="row" id="row-pg">
    <div><div class="label" data-k="pgT"></div><div class="help" data-k="pgHelp"></div></div>
    <div class="picker"><span class="state" id="pg-state"></span><span class="toggle" id="pg"></span></div>
  </div>
  <div class="sec" data-k="secPad"></div>
  <div class="row" id="row-controls">
    <div><div class="label" data-k="ctrlT"></div><div class="help" data-k="ctrlHelp"></div></div>
    <span class="chip">${ICON_PAD} <span data-k="ctrlBtn"></span></span>
  </div>
  <div class="row" id="row-dnav">
    <div><div class="label" data-k="dnavT"></div><div class="help" data-k="dnavHelp"></div></div>
    <div class="picker"><span class="state" id="dnav-state"></span><span class="toggle" id="dnav"></span></div>
  </div>
  <div class="row" id="row-vib">
    <div><div class="label" data-k="vibT"></div><div class="help" data-k="vibHelp"></div></div>
    <div class="picker"><span class="arrow" id="vbdown">&minus;</span><span class="bar" style="width:200px"><i id="vibbar"></i></span><span class="arrow" id="vbup">+</span><span class="pct" id="vibpct" style="min-width:96px"></span></div>
  </div>
  <div class="row" id="row-touch">
    <div><div class="label" data-k="touchT"></div><div class="help" data-k="touchHelp"></div></div>
    <div class="picker"><span class="state" id="touch-state"></span><span class="toggle" id="touch"></span></div>
  </div>
  <div class="row" id="row-batt">
    <div><div class="label" data-k="battT"></div><div class="help" data-k="battHelp"></div></div>
    <div class="value" id="batt" style="width:auto;max-width:520px;text-align:right"></div>
  </div>
  <div class="row" id="row-split">
    <div><div class="label" data-k="splitT"></div><div class="help" data-k="splitHelp"></div></div>
    <div class="picker"><span class="arrow" id="spprev">&#9664;</span><span class="value" id="split" style="width:220px"></span><span class="arrow" id="spnext">&#9654;</span></div>
  </div>
  <div class="row" id="row-rem" style="display:none">
    <div><div class="label" data-k="remT"></div><div class="help" data-k="remHelp"></div></div>
    <div class="picker"><span class="state" id="rem-state"></span><span class="toggle" id="rem"></span></div>
  </div>
  <div class="sec" data-k="secDash"></div>
  <div class="row" id="row-social">
    <div><div class="label" data-k="socialT"></div><div class="help" data-k="socialHelp"></div></div>
    <div class="picker"><span class="state" id="social-state"></span><span class="toggle" id="social"></span></div>
  </div>
  <div class="row" id="row-wait">
    <div><div class="label" data-k="waitT"></div><div class="help" data-k="waitHelp"></div></div>
    <div class="picker"><span class="state" id="wait-state"></span><span class="toggle" id="wait"></span></div>
  </div>
  <div class="row" id="row-splash">
    <div><div class="label" data-k="splashT"></div><div class="help" data-k="splashHelp"></div></div>
    <div class="picker"><span class="state" id="splash-state"></span><span class="toggle" id="splash"></span></div>
  </div>
  <div class="row" id="row-fb">
    <div><div class="label" data-k="fbT"></div><div class="help" data-k="fbHelp"></div></div>
    <div class="picker"><span class="state" id="fb-state"></span><span class="toggle" id="fb"></span></div>
  </div>
  <div class="row" id="row-anim">
    <div><div class="label" data-k="animT"></div><div class="help" data-k="animHelp"></div></div>
    <div class="picker"><span class="state" id="anim-state"></span><span class="toggle" id="anim"></span></div>
  </div>
  <div class="row" id="row-ana">
    <div><div class="label" data-k="anaT"></div><div class="help" data-k="anaHelp"></div></div>
    <div class="picker"><span class="state" id="ana-state"></span><span class="toggle" id="ana"></span></div>
  </div>
  <div class="sec" data-k="secBato"></div>
  <div class="row" id="row-glist">
    <div><div class="label" data-k="glT"></div><div class="help" id="gl-help"></div>
      <div class="glbar" id="gl-bar" style="display:none"><span class="bar"><i id="gl-fill"></i></span><span class="glpct" id="gl-pct"></span></div></div>
    <div class="picker"><span class="arrow" id="gprev">&#9664;</span><span class="value" id="glist" style="width:260px"></span><span class="arrow" id="gnext">&#9654;</span></div>
  </div>
  <div class="row" id="row-gpick" style="display:none">
    <div><div class="label" data-k="gpT"></div><div class="help" id="gp-help"></div></div>
    <div class="picker"><span class="state" id="gpick-state"></span><span class="toggle" id="gpick"></span></div>
  </div>
  <div class="row" id="row-g3d" style="display:none">
    <div><div class="label" data-k="g3dT"></div><div class="help" data-k="g3dHelp"></div></div>
    <div class="picker"><span class="state" id="g3d-state"></span><span class="toggle" id="g3d"></span></div>
  </div>
  <div class="sec" data-k="secHelp"></div>
  <div class="row" id="row-reload" style="display:${state.reload ? 'flex' : 'none'}">
    <div><div class="label" data-k="reloadT"></div><div class="help" data-k="reloadHelp"></div></div>
    <span class="chip">${ICON_RELOAD} <span data-k="reloadBtn"></span></span>
  </div>
  <div class="row" id="row-cache">
    <div><div class="label" data-k="cacheT"></div><div class="help" data-k="cacheHelp"></div></div>
    <span class="chip">${ICON_CACHE} <span id="cache"></span></span>
  </div>
  <div class="row" id="row-logs">
    <div><div class="label" data-k="logsT"></div><div class="help" id="logs-help"></div></div>
    <span class="chip">${ICON_LOGS} <span id="logs"></span></span>
  </div>
  <div class="row" id="row-backup">
    <div><div class="label" data-k="bkT"></div><div class="help" id="bk-help"></div></div>
    <span class="chip" id="bk-chip">${ICON_BACKUP} <span id="bk"></span></span>
  </div>
  <div class="row" id="row-restore">
    <div><div class="label" data-k="rsT"></div><div class="help" id="rs-help"></div></div>
    <span class="chip" id="rs-chip">${ICON_RESTORE} <span id="rs"></span></span>
  </div>
  <div class="row" id="row-update">
    <div><div class="label" data-k="updT"></div><div class="help" id="upd-help"></div></div>
    <span class="chip" id="upd-chip">${ICON_UPDATE} <span id="upd"></span></span>
  </div>
  </div>
  <div class="cpanel" id="controls">
    <div class="clist" id="clist"></div>
    <div class="cback"><button class="on" id="cback" data-k="ctrlBack"></button></div>
  </div>
  <div class="buttons"><button class="save" id="save" data-k="save"></button><button class="cancel" id="cancel" data-k="cancel"></button></div>
  <p class="hint" id="hint"></p>
</div>
<script>
(function () {
  var S = ${JSON.stringify(state).replace(/</g, '\\u003c')};
  // the region list: an address that isn't one of the regions shows first, as "Custom"
  var regions = (S.custom ? ['custom'] : []).concat(S.codes);
  var ri = Math.max(0, regions.indexOf(S.region));
  var li = Math.max(0, S.langs.findIndex(function (l) { return l[0] === S.choice; }));
  var INTRO = ['always', 'daily', 'off'], ii = Math.max(0, INTRO.indexOf(S.intro));
  var GL = ['off', 'all', 'picked'], gi = Math.max(0, GL.indexOf(S.glist));
  // the stream options
  var RES = ['auto', '1080p', '1080p-hq', '1440p'], rsi = Math.max(0, RES.indexOf(S.res));
  var SH = ['off', 'low', 'medium', 'high'], shi = Math.max(0, SH.indexOf(S.sharpen));
  var ui_ = Math.max(0, S.unlocks.indexOf(S.unlock));
  // a child's profile doesn't get the rows that look after the whole machine
  // the game list's own rows only show while it's on: "This game in
  // Batocera's list" with Games I pick (on a game's page), 3D game boxes with
  // either choice; they come and go as the choice above them changes
  var rows = [], LAST = 0;
  // Xbox Cloud Gaming's options that Luna doesn't have (or that aren't ready
  // for Luna yet): never shown
  var NOT_ON_LUNA = ['row-user', 'row-unlock', 'row-boost', 'row-res', 'row-net', 'row-windows', 'row-ipv6', 'row-mic', 'row-steady', 'row-recon', 'row-alive', 'row-replay',
    'row-up', 'row-ut', 'row-us', 'row-clean', 'row-pg', 'row-vib', 'row-touch', 'row-split', 'row-rem',
    'row-social', 'row-wait', 'row-splash', 'row-fb', 'row-anim', 'row-ana', 'row-g3d'];
  NOT_ON_LUNA.forEach(function (id) { var e = document.getElementById(id); if (e) e.style.display = 'none'; });
  Array.prototype.forEach.call(document.querySelectorAll('.sec[data-k="secDash"]'), function (e) { e.style.display = 'none'; });
  function buildRows() {
    // the same order as on screen, section by section
    rows = ['row-signout', 'row-soe']
      .concat(['row-region', 'row-language', 'row-volume', 'row-highlight', 'row-intro', 'row-isound', 'row-low'])
      .concat(['row-gpu', 'row-stats'])
      .concat(['row-sharpen', 'row-clarity', 'row-ct', 'row-sa', 'row-br'])
      .concat(['row-controls', 'row-dnav', 'row-batt'])
      .concat(['row-glist'].concat(S.game && GL[gi] === 'picked' ? ['row-gpick'] : []))
      .concat(S.reload ? ['row-reload'] : []).concat(['row-cache', 'row-logs', 'row-backup', 'row-restore', 'row-update', 'buttons']);
    LAST = rows.length - 1;
    ['row-gpick'].forEach(function (id) { document.getElementById(id).style.display = rows.indexOf(id) >= 0 ? 'flex' : 'none'; });
  }
  var copen = false;   // the Controls list is showing
  var row = 0, btn = 0, sent = false, confirmUntil = 0, confirmTimer = null;
  function cur() { return rows[row]; }
  // the language the screen is shown in: the one picked, or Batocera's for "Same as Batocera"
  function ui() { return S.langs[li][0] === 'auto' ? S.detected : S.langs[li][0]; }
  function autonym(code) { var f = S.langs.filter(function (l) { return l[0] === code; })[0]; return f ? f[1] : code; }
  // a short beep at the chosen volume, so you can hear the level
  var actx = null;
  function beep(level) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      var o = actx.createOscillator(), g = actx.createGain();
      o.frequency.value = 660; g.gain.value = 0.25 * (level === undefined ? S.volume : level) / 100;
      o.connect(g); g.connect(actx.destination);
      o.start(); o.stop(actx.currentTime + 0.09);
    } catch (e) { /* no sound device */ }
  }
  var $ = function (id) { return document.getElementById(id); };
  buildRows();
  // opened over a game's page with Games I pick: straight to "This game in Batocera's list"
  if (S.game && S.glist === 'picked' && rows.indexOf('row-gpick') >= 0) row = rows.indexOf('row-gpick');
  function tx(k, vars) {
    var s = S.T[ui()][k];
    if (vars) s = s.replace(/\\{(\\w+)\\}/g, function (m, n) { return n in vars ? vars[n] : m; });
    return s;
  }
  function regionName(code) {
    if (code === 'custom') return tx('custom', { url: S.custom });
    return S.names[ui()][S.codes.indexOf(code)];
  }
  function confirming() { return Date.now() < confirmUntil; }
  // a country's name in the screen's language (Europe has its own text)
  function unlockName(c) {
    if (c === 'off') return tx('off');
    if (c === 'eu') return tx('unlockEu');
    try { return new Intl.DisplayNames([ui()], { type: 'region' }).of(c.toUpperCase()); } catch (e) { return c.toUpperCase(); }
  }
  // the names of the controller's View and Menu buttons
  function padNames() {
    var id = '';
    try { var ps = navigator.getGamepads(); for (var i = 0; i < ps.length; i++) if (ps[i]) { id = ps[i].id; break; } } catch (e) {}
    id = id.toLowerCase();
    if (/054c|sony|playstation|dualshock|dualsense/.test(id)) return { view: 'Share', menu: 'Options' };
    return { view: 'View', menu: 'Menu' };
  }
  function renderControls() {
    var n = padNames(), T = S.T[ui()];
    var vars = { view: n.view, menu: n.menu, t: T._t, t1: T._t1 };
    var list = $('clist');
    list.textContent = '';
    for (var i = 1; i <= 11; i++) {
      if (i === 9) continue;   // (opening a whole row: Xbox's dashboard only)
      var r = document.createElement('div'); r.className = 'crow';
      var k = document.createElement('div'); k.className = 'k'; k.textContent = tx('c' + i + 'a', vars);
      var d = document.createElement('div'); d.className = 'd'; d.textContent = tx('c' + i + 'b', vars);
      r.appendChild(k); r.appendChild(d); list.appendChild(r);
    }
  }
  function updText() {
    var u = S.upd || { state: 'idle' };
    if (u.state === 'checking') return tx('updChecking');
    if (u.state === 'none') return tx('updNone');
    if (u.state === 'getting') return tx('updGetting', { p: u.p || 0 });
    if (u.state === 'done') return tx('updDone');
    if (u.state === 'fail') return tx('updFail');
    return tx('updBtn');
  }
  function render() {
    document.documentElement.lang = ui();
    Array.prototype.forEach.call(document.querySelectorAll('[data-k]'), function (el) { el.textContent = tx(el.getAttribute('data-k')); });
    // on the Controls page: "Controls" as the title, under "Settings"
    $('title').textContent = tx(copen ? 'ctrlT' : 'settings');
    $('crumb').textContent = (copen ? 'Amazon Luna \u203a ' + tx('settings') : 'Amazon Luna') + (S.user ? ' \u00b7 ' + S.user : '');
    $('user-help').textContent = S.user ? tx('profHelp', { name: S.user }) : tx('profHelpNone');
    $('cache').textContent = S.cache === 'busy' ? tx('cacheBusy') : S.cache ? tx('cacheDone', { mb: S.cache }) : tx('cacheBtn');
    var uv = S.upd && S.upd.state === 'done' ? S.upd : null;
    $('upd-help').textContent = tx('updHelp', { a: (uv && uv.a) || S.appv, e: (uv && uv.e) || S.engine });
    $('logs').textContent = S.logs === 'busy' ? tx('logsBusy') : S.logs === 'fail' ? tx('logsFail') : S.logs ? '\u2713' : tx('logsBtn');
    $('logs-help').textContent = S.logs && S.logs !== 'busy' && S.logs !== 'fail' ? tx('logsDone', { file: S.logs }) : tx('logsHelp');
    $('upd').textContent = updText();
    $('upd-chip').className = 'chip' + (S.upd && (S.upd.state === 'getting' || S.upd.state === 'done') ? ' go' : '');
    document.querySelector('.card').className = 'card' + (copen ? ' copen' : '');
    if (copen) renderControls();
    $('region').textContent = regionName(regions[ri]);
    $('count').textContent = tx('of', { i: ri + 1, n: regions.length });
    $('language').textContent = S.langs[li][0] === 'auto' ? tx(S.hippos ? 'autoH' : 'auto', { lang: autonym(S.detected) }) : S.langs[li][1];
    $('lcount').textContent = tx('of', { i: li + 1, n: S.langs.length });
    $('vbar').style.width = S.volume + '%';
    $('vbar').parentNode.className = 'bar' + (S.vmute ? ' off' : '');
    $('vpct').textContent = S.vmute ? tx('muted') : S.volume + '%';
    $('vmute').className = 'toggle mute' + (S.vmute ? ' yes' : '');
    $('highlight').className = 'toggle' + (S.highlight ? ' yes' : '');
    $('highlight-state').textContent = S.highlight ? tx('on') : tx('off');
    $('soe').className = 'toggle' + (S.soe ? ' yes' : '');
    $('soe-state').textContent = S.soe ? tx('on') : tx('off');
    $('glist').textContent = tx({ off: 'glOff', all: 'glAll', picked: 'glPick' }[GL[gi]]);
    var busy = S.glPct != null;
    $('gl-bar').style.display = busy ? 'flex' : 'none';
    if (busy) { $('gl-fill').style.width = S.glPct + '%'; $('gl-pct').textContent = S.glPct + '%'; }
    $('gl-help').textContent = busy || S.glBusy ? tx('glBusy') : tx({ off: 'glHelpOff', all: 'glHelpAll', picked: 'glHelpPick' }[GL[gi]]) +
      (GL[gi] === S.glist && S.glist !== 'off' && S.glCount ? ' \u00b7 ' + tx('glCount', { n: S.glCount }) : '');
    if (S.game) {
      var canPick = GL[gi] === 'picked';
      $('gpick').className = 'toggle' + (S.gpicked && canPick ? ' yes' : '') + (canPick ? '' : ' dim');
      $('gpick-state').textContent = canPick ? (S.gpicked ? tx('on') : tx('off')) : '';
      $('gp-help').textContent = canPick ? S.game.title : tx('gpOnly');
    }
    $('g3d').className = 'toggle' + (S.g3d ? ' yes' : '');
    $('g3d-state').textContent = S.g3d ? tx('on') : tx('off');
    $('intro').textContent = tx({ always: 'introAlways', daily: 'introDaily', off: 'introOff' }[INTRO[ii]]);
    $('ibar').style.width = S.ivol + '%';
    $('ibar').parentNode.className = 'bar' + (S.imute ? ' off' : '');
    $('ipct').textContent = S.imute ? tx('muted') : S.ivol + '%';
    $('imute').className = 'toggle mute' + (S.imute ? ' yes' : '');
    $('windows').className = 'toggle' + (S.windows ? ' yes' : '');
    $('windows-state').textContent = S.windows ? tx('on') : tx('off');
    $('res').textContent = tx({ auto: 'resAuto', '1080p': 'res1080', '1080p-hq': 'resHq', '1440p': 'res1440' }[RES[rsi]]);
    $('res-help').textContent = tx({ auto: 'resHelpAuto', '1080p': 'resHelp1080', '1080p-hq': 'resHelpHq', '1440p': 'resHelp1440' }[RES[rsi]]);
    $('sharpen').textContent = tx({ off: 'off', low: 'shLow', medium: 'shMed', high: 'shHigh' }[SH[shi]]);
    $('clarity').className = 'toggle' + (S.clarity ? ' yes' : '');
    $('clarity-state').textContent = S.clarity ? tx('on') : tx('off');
    ['ct', 'sa', 'br'].forEach(function (k) {
      $(k + 'bar').style.width = S.pic[k] - 50 + '%';
      $(k + 'pct').textContent = S.pic[k] + '%';
    });
    $('gpu').className = 'toggle' + (S.gpu ? ' yes' : '');
    $('gpu-state').textContent = S.gpu ? tx('on') : tx('off');
    $('unlock').textContent = unlockName(S.unlocks[ui_]);
    $('bobar').style.width = (S.boost - 100) / 5 + '%';
    $('bopct').textContent = S.boost + '%';
    $('ut').textContent = S.ut === 'screen' ? tx('utScreen') : S.ut === '2160' ? '4K' : S.ut + 'p';
    $('usbar').style.width = S.us + '%';
    $('uspct').textContent = S.us + '%';
    $('split').textContent = S.split ? tx('splitN', { n: S.split }) : tx('off');
    $('batt').textContent = S.batt && S.batt.length ? S.batt.map(function (b) { return b.name + ' ' + b.pct + '%' + (b.charging ? ' \u26a1' : ''); }).join('  \u00b7  ') : tx('battNone');
    var nt = S.net;
    $('net').textContent = nt === 'busy' ? tx('netBusy') : tx('netBtn');
    $('net-help').textContent = nt && nt !== 'busy' ? (nt.fail ? tx('netFail') : tx('netResult', { d: nt.mbps, p: nt.ping, r: tx({ auto: 'resAuto', '1080p': 'res1080', '1080p-hq': 'resHq', '1440p': 'res1440' }[nt.rec]) })) : tx('netHelp');
    ['social', 'ipv6', 'mic', 'wait', 'touch', 'up', 'splash', 'fb', 'anim', 'ana', 'clean', 'steady', 'pg', 'rem', 'replay', 'alive', 'recon', 'dnav'].forEach(function (k) {
      $(k).className = 'toggle' + (S[k] ? ' yes' : '');
      $(k + '-state').textContent = S[k] ? tx('on') : tx('off');
    });
    $('stats').className = 'toggle' + (S.stats ? ' yes' : '');
    $('stats-state').textContent = S.stats ? tx('on') : tx('off');
    $('vibbar').style.width = S.vib + '%';
    $('vibbar').parentNode.className = 'bar' + (S.vib ? '' : ' off');
    $('vibpct').textContent = S.vib ? S.vib + '%' : tx('off');
    $('signout').textContent = confirming() ? tx('signOutConfirm') : tx('signOutBtn');
    $('signout-chip').className = 'chip' + (confirming() ? ' warn' : '');
    var noting = Date.now() < noteUntil;
    $('hint').textContent = noting ? note : tx('sHint') + (S.reload ? tx('sHintR') : '') + tx('sHintSec');
    $('hint').style.color = noting ? '#c4a6ff' : '';
    $('low-help').textContent = S.lowDone ? tx('lowDone') : tx('lowHelp');
    $('bk').textContent = S.bk === 'busy' ? tx('bkBusy') : S.bk === 'done' ? '\u2713' : tx('bkBtn');
    $('bk-help').textContent = S.bk === 'done' && S.backup ? tx('bkDone', { file: S.backup.f }) : S.bk === 'fail' ? tx('bkFail') : tx('bkHelp');
    var rsAsk = Date.now() < rsUntil;
    $('rs').textContent = S.rs === 'busy' ? tx('rsBusy') : S.rs === 'done' ? '\u2713' : rsAsk ? tx('rsConfirm') : tx('rsBtn');
    $('rs-chip').className = 'chip' + (rsAsk && !S.rs ? ' warn' : '');
    var when = '';
    try { when = S.backup ? new Date(S.backup.t).toLocaleString(ui(), { dateStyle: 'medium', timeStyle: 'short' }) : ''; } catch (e) { when = S.backup ? new Date(S.backup.t).toLocaleString() : ''; }
    $('rs-help').textContent = S.rs === 'done' ? tx('rsDone') : S.rs === 'fail' ? tx('rsFail') : S.backup ? tx('rsHelp', { file: S.backup.f, date: when }) : tx('rsNone');
    rows.forEach(function (id, i) { if (id !== 'buttons') $(id).className = 'row' + (i === row ? ' on' : ''); });
    $('save').className = 'save' + (row === LAST && btn === 0 ? ' on' : '');
    $('cancel').className = 'cancel' + (row === LAST && btn === 1 ? ' on' : '');
    if (cur() !== 'buttons') {
      try {
        // the first row of a section brings its heading into view too
        var el = $(cur()), prev = el.previousElementSibling;
        el.scrollIntoView({ block: 'nearest' });
        if (prev && prev.className === 'sec') prev.scrollIntoView({ block: 'nearest' });
      } catch (e) {}
    }
  }
  function go(path) {
    if (sent) return;
    sent = true; setTimeout(function () { sent = false; }, 3000);
    location.href = '${ACTION_PREFIX}' + path;
  }
  // ---- sections: LB / RB (Page Up / Down) jump between them, Y resets one ----
  function secOf(id) {
    if (id === 'buttons') return 'buttons';
    var e = $(id);
    while (e && e.className !== 'sec') e = e.previousElementSibling;
    return e ? e.getAttribute('data-k') : '';
  }
  function firstOf(s) { for (var i = 0; i < rows.length; i++) if (secOf(rows[i]) === s) return i; return 0; }
  function jump(dir) {
    var s = secOf(cur());
    if (dir > 0) {
      for (var i = row + 1; i < rows.length; i++) if (secOf(rows[i]) !== s) { row = i; break; }
    } else {
      var f = firstOf(s);
      if (f !== row) row = f;
      else if (row > 0) row = firstOf(secOf(rows[row - 1]));
    }
    render();
  }
  var note = '', noteUntil = 0, noteTimer = null, resetAsk = '', resetUntil = 0, rsUntil = 0;
  function say(t) { note = t; noteUntil = Date.now() + 4000; clearTimeout(noteTimer); noteTimer = setTimeout(render, 4100); }
  // each section's choices back to how the app comes (Region and Language stay as they are)
  var RESET = {
    secAcct: function () { S.soe = false; },
    secGen: function () { S.volume = 100; S.vmute = false; S.highlight = true; ii = 0; S.ivol = 100; S.imute = false; },
    secStream: function () { S.gpu = false; S.stats = false; },
    secPic: function () { shi = 0; S.clarity = false; S.pic = { ct: 100, sa: 100, br: 100 }; },
    secPad: function () { S.dnav = false; },
    secDash: function () { }
  };
  function resetSection() {
    var s = secOf(cur());
    if (!RESET[s]) { say(tx('resetNone')); render(); return; }
    if (resetAsk === s && Date.now() < resetUntil) {
      resetAsk = '';
      RESET[s]();
      buildRows(); row = firstOf(s);
      say(tx('resetDone', { sec: tx(s) })); render();
      return;
    }
    resetAsk = s; resetUntil = Date.now() + 4000;
    say(tx('resetQ', { sec: tx(s) })); render();
  }
  // Low-power settings: the lighter choices for slower devices (Save keeps them)
  function lowPower() {
    shi = 0; S.clarity = false; S.stats = false;
    S.lowDone = true; buildRows(); row = rows.indexOf('row-low'); render();
  }
  // Back up: the settings, profiles (no sign-ins) and picked games in one file in the share folder
  function backup() {
    if (S.bk === 'busy') return;
    S.bk = 'busy'; render();
    location.href = '${ACTION_PREFIX}settings-backup';
  }
  window.__backupStatus = function (r) { S.bk = r && r.f ? 'done' : 'fail'; if (r && r.f) S.backup = r; render(); };
  // Restore: the newest backup in the share folder (A twice); the app closes afterwards
  function restore() {
    if (!S.backup || S.rs === 'busy' || S.rs === 'done') { render(); return; }
    if (Date.now() < rsUntil) { S.rs = 'busy'; render(); go('settings-restore?f=' + encodeURIComponent(S.backup.f)); return; }
    rsUntil = Date.now() + 4000; setTimeout(render, 4100); render();
  }
  window.__restoreStatus = function (ok) { S.rs = ok ? 'done' : 'fail'; sent = false; render(); };
  function save() {
    go('settings-save?region=' + encodeURIComponent(regions[ri]) + '&lang=' + encodeURIComponent(S.langs[li][0]) +
       '&volume=' + S.volume + '&highlight=' + (S.highlight ? 1 : 0) + '&intro=' + INTRO[ii] + '&windows=' + (S.windows ? 1 : 0) +
       '&res=' + RES[rsi] + '&sharpen=' + SH[shi] + '&clarity=' + (S.clarity ? 1 : 0) + '&ct=' + S.pic.ct + '&sa=' + S.pic.sa + '&br=' + S.pic.br + '&gpu=' + (S.gpu ? 1 : 0) + '&stats=' + (S.stats ? 1 : 0) + '&vib=' + S.vib +
       '&unlock=' + S.unlocks[ui_] + '&boost=' + S.boost + '&social=' + (S.social ? 1 : 0) + '&ipv6=' + (S.ipv6 ? 1 : 0) + '&mic=' + (S.mic ? 1 : 0) + '&wait=' + (S.wait ? 1 : 0) + '&touch=' + (S.touch ? 1 : 0) +
       '&up=' + (S.up ? 1 : 0) + '&splash=' + (S.splash ? 1 : 0) + '&fb=' + (S.fb ? 1 : 0) + '&anim=' + (S.anim ? 1 : 0) + '&ana=' + (S.ana ? 1 : 0) +
       '&ut=' + S.ut + '&us=' + S.us + '&clean=' + (S.clean ? 1 : 0) + '&steady=' + (S.steady ? 1 : 0) + '&pg=' + (S.pg ? 1 : 0) + '&split=' + S.split +
       '&rem=' + (S.rem ? 1 : 0) + '&replay=' + (S.replay ? 1 : 0) + '&alive=' + (S.alive ? 1 : 0) + '&recon=' + (S.recon ? 1 : 0) +
       '&ivol=' + S.ivol + '&imute=' + (S.imute ? 1 : 0) + '&vmute=' + (S.vmute ? 1 : 0) + '&soe=' + (S.soe ? 1 : 0) + '&glist=' + GL[gi] + '&g3d=0' + '&dnav=' + (S.dnav ? 1 : 0) +
         (S.game ? '&gid=' + S.game.id + '&gslug=' + encodeURIComponent(S.game.slug) + '&gpick=' + (S.gpicked ? 1 : 0) : ''));
  }
  function cancel() { go('settings-cancel'); }
  // Updates: one press checks the app and the engine and gets whatever is
  // newer by itself; it's used the next time the app opens
  // the connection check: download speed and ping, and the resolution they suit
  // (A again, once there's a result: use it)
  function netTest() {
    if (S.net === 'busy') return;
    if (S.net && !S.net.fail && S.net.rec) { rsi = Math.max(0, RES.indexOf(S.net.rec)); row = rows.indexOf('row-res'); S.net = null; render(); return; }
    S.net = 'busy'; render();
    location.href = '${ACTION_PREFIX}settings-nettest';
  }
  window.__netResult = function (r) { S.net = r; render(); };
  function update() {
    var st = (S.upd || {}).state || 'idle';
    if (st !== 'idle' && st !== 'none' && st !== 'fail') return;
    S.upd = { state: 'checking', p: 0 };
    render();
    location.href = '${ACTION_PREFIX}settings-update-check';
  }
  window.__updateStatus = function (u) { S.upd = u; render(); };
  // the game list update's progress, live (null: finished)
  window.__glProgress = function (p) { S.glPct = p; if (p == null) S.glBusy = false; render(); };
  // Clear cache: the stored copies of web pages, pictures and scripts (not the sign-in)
  function clearCache() {
    if (S.cache === 'busy') return;
    S.cache = 'busy'; render();
    location.href = '${ACTION_PREFIX}settings-clear-cache';
  }
  window.__cacheStatus = function (mb) { S.cache = mb; render(); };
  function saveLogs() {
    if (S.logs === 'busy') return;
    S.logs = 'busy'; render();
    location.href = '${ACTION_PREFIX}settings-logs';
  }
  window.__logsStatus = function (f) { S.logs = f || 'fail'; render(); };
  function openControls() { copen = true; render(); try { $('clist').scrollTop = 0; } catch (e) {} }
  function closeControls() { copen = false; render(); }
  function reload() { if (S.reload) go('settings-reload'); }
  // sign out needs a second press within 4 seconds
  function signOut() {
    if (confirming()) { go('settings-signout'); return; }
    confirmUntil = Date.now() + 4000;
    clearTimeout(confirmTimer); confirmTimer = setTimeout(render, 4100);
    render();
  }
  function change(step) {
    var r = cur();
    if (r === 'row-region') ri = (ri + step + regions.length) % regions.length;
    else if (r === 'row-language') li = (li + step + S.langs.length) % S.langs.length;
    else if (r === 'row-volume') {
      var v = Math.min(100, Math.max(0, Math.round((S.volume + step * 10) / 10) * 10));
      if (v !== S.volume || S.vmute) { S.volume = v; S.vmute = false; beep(); }
    }
    else if (r === 'row-highlight') S.highlight = !S.highlight;
    else if (r === 'row-soe') S.soe = !S.soe;
    else if (r === 'row-g3d') S.g3d = !S.g3d;
    else if (r === 'row-glist') { gi = (gi + step + GL.length) % GL.length; buildRows(); row = rows.indexOf('row-glist'); }
    else if (r === 'row-gpick') { if (GL[gi] === 'picked') S.gpicked = !S.gpicked; }
    else if (r === 'row-intro') ii = (ii + step + INTRO.length) % INTRO.length;
    else if (r === 'row-isound') {
      var iv = Math.min(100, Math.max(0, Math.round((S.ivol + step * 10) / 10) * 10));
      if (iv !== S.ivol) { S.ivol = iv; S.imute = false; beep(S.ivol); }
    }
    else if (r === 'row-windows') S.windows = !S.windows;
    else if (r === 'row-res') rsi = (rsi + step + RES.length) % RES.length;
    else if (r === 'row-sharpen') shi = (shi + step + SH.length) % SH.length;
    else if (r === 'row-stats') S.stats = !S.stats;
    else if (r === 'row-unlock') ui_ = (ui_ + step + S.unlocks.length) % S.unlocks.length;
    else if (r === 'row-boost') S.boost = Math.min(600, Math.max(100, S.boost + step * 50));
    else if (r === 'row-social') S.social = !S.social;
    else if (r === 'row-ipv6') S.ipv6 = !S.ipv6;
    else if (r === 'row-mic') S.mic = !S.mic;
    else if (r === 'row-wait') S.wait = !S.wait;
    else if (r === 'row-touch') S.touch = !S.touch;
    else if (r === 'row-up') { S.up = !S.up; buildRows(); row = rows.indexOf('row-up'); }
    else if (r === 'row-ut') { var UT = ['screen', '1080', '1440', '2160']; S.ut = UT[(UT.indexOf(S.ut) + step + UT.length) % UT.length]; }
    else if (r === 'row-us') S.us = Math.min(100, Math.max(0, S.us + step * 10));
    else if (r === 'row-clean') S.clean = !S.clean;
    else if (r === 'row-steady') S.steady = !S.steady;
    else if (r === 'row-pg') S.pg = !S.pg;
    else if (r === 'row-split') { var SP = [0, 2, 3, 4]; S.split = SP[(SP.indexOf(S.split) + step + SP.length) % SP.length]; buildRows(); row = rows.indexOf('row-split'); }
    else if (r === 'row-rem') S.rem = !S.rem;
    else if (r === 'row-dnav') S.dnav = !S.dnav;
    else if (r === 'row-replay') S.replay = !S.replay;
    else if (r === 'row-alive') S.alive = !S.alive;
    else if (r === 'row-recon') S.recon = !S.recon;
    else if (r === 'row-splash') S.splash = !S.splash;
    else if (r === 'row-fb') S.fb = !S.fb;
    else if (r === 'row-anim') S.anim = !S.anim;
    else if (r === 'row-ana') S.ana = !S.ana;
    else if (r === 'row-gpu') S.gpu = !S.gpu;
    else if (r === 'row-clarity') S.clarity = !S.clarity;
    else if (r === 'row-ct' || r === 'row-sa' || r === 'row-br') { var pk = r.slice(4); S.pic[pk] = Math.min(150, Math.max(50, S.pic[pk] + step * 5)); }
    else if (r === 'row-vib') S.vib = Math.min(100, Math.max(0, S.vib + step * 25));
    else if (r === 'buttons') btn = btn === 0 ? 1 : 0;
    else return;
    render();
  }
  function select() {
    var r = cur();
    if (r === 'buttons') { btn === 0 ? save() : cancel(); return; }
    if (r === 'row-volume') { S.vmute = !S.vmute; render(); if (!S.vmute) beep(); return; } // A / Enter: mute or unmute
    if (r === 'row-reload') { reload(); return; }
    if (r === 'row-signout') { signOut(); return; }
    if (r === 'row-controls') { openControls(); return; }
    if (r === 'row-user') { location.href = '${ACTION_PREFIX}settings-profiles'; return; }
    if (r === 'row-cache') { clearCache(); return; }
    if (r === 'row-logs') { saveLogs(); return; }
    if (r === 'row-update') { update(); return; }
    if (r === 'row-net') { netTest(); return; }
    if (r === 'row-low') { lowPower(); return; }
    if (r === 'row-backup') { backup(); return; }
    if (r === 'row-restore') { restore(); return; }
    if (r === 'row-isound') { S.imute = !S.imute; render(); return; }   // A / Enter: mute or unmute
    if (r === 'row-ct' || r === 'row-sa' || r === 'row-br') { S.pic[r.slice(4)] = 100; render(); return; }   // A / Enter: back to 100%
    if (r === 'row-boost') { S.boost = 100; render(); return; }   // A / Enter: no boost
    if (r === 'row-us') { S.us = 60; render(); return; }          // A / Enter: the usual sharpening
    change(1);
  }
  window.addEventListener('keydown', function (e) {
    var k = e.key;
    if (copen) {
      // the Controls list: up / down scroll it, anything else goes back
      e.preventDefault();
      if (k === 'ArrowUp') $('clist').scrollTop -= 90;
      else if (k === 'ArrowDown') $('clist').scrollTop += 90;
      else if (k === 'Escape' || k === 'Backspace' || k === 'Enter' || k === 'NumpadEnter' || k === ' ' || k === 'x' || k === 'X' || k === 'F10') closeControls();
      return;
    }
    if (k === 'ArrowUp' || (k === 'Tab' && e.shiftKey)) { e.preventDefault(); row = (row + LAST) % rows.length; render(); }
    else if (k === 'ArrowDown' || k === 'Tab') { e.preventDefault(); row = (row + 1) % rows.length; render(); }
    else if (k === 'ArrowLeft') { e.preventDefault(); change(-1); }
    else if (k === 'ArrowRight') { e.preventDefault(); change(1); }
    else if (k === 'Enter' || k === 'NumpadEnter' || k === ' ' || k === 'x' || k === 'X') { e.preventDefault(); select(); }
    else if (k === 'Escape' || k === 'Backspace') { e.preventDefault(); cancel(); }
    else if (k === 'r' || k === 'R') { e.preventDefault(); reload(); }
    else if (k === 'PageDown') { e.preventDefault(); jump(1); }   // RB
    else if (k === 'PageUp') { e.preventDefault(); jump(-1); }    // LB
    else if (k === 'y' || k === 'Y') { e.preventDefault(); resetSection(); }
    else if (k === 'F10' || k === 's' || k === 'S') { e.preventDefault(); save(); } // F10 = the controller's Menu button (sent by the app)
  });
  // mouse
  function rowOf(id) { return rows.indexOf(id); }
  function arrow(id, r, step) { $(id).addEventListener('click', function (e) { e.stopPropagation(); row = rowOf(r); change(step); }); }
  arrow('prev', 'row-region', -1); arrow('next', 'row-region', 1);
  arrow('lprev', 'row-language', -1); arrow('lnext', 'row-language', 1);
  arrow('vdown', 'row-volume', -1); arrow('vup', 'row-volume', 1);
  arrow('iprev', 'row-intro', -1); arrow('inext', 'row-intro', 1);
  arrow('gprev', 'row-glist', -1); arrow('gnext', 'row-glist', 1);
  arrow('idown', 'row-isound', -1); arrow('iup', 'row-isound', 1);
  arrow('rsprev', 'row-res', -1); arrow('rsnext', 'row-res', 1);
  arrow('shprev', 'row-sharpen', -1); arrow('shnext', 'row-sharpen', 1);
  arrow('vbdown', 'row-vib', -1); arrow('vbup', 'row-vib', 1);
  arrow('ulprev', 'row-unlock', -1); arrow('ulnext', 'row-unlock', 1);
  arrow('bodown', 'row-boost', -1); arrow('boup', 'row-boost', 1);
  arrow('utprev', 'row-ut', -1); arrow('utnext', 'row-ut', 1);
  arrow('usdown', 'row-us', -1); arrow('usup', 'row-us', 1);
  arrow('spprev', 'row-split', -1); arrow('spnext', 'row-split', 1);
  ['ct', 'sa', 'br'].forEach(function (k) { arrow(k + 'down', 'row-' + k, -1); arrow(k + 'up', 'row-' + k, 1); });
  $('vmute').addEventListener('click', function (e) { e.stopPropagation(); row = rowOf('row-volume'); S.vmute = !S.vmute; render(); if (!S.vmute) beep(); });
  $('imute').addEventListener('click', function (e) { e.stopPropagation(); row = rowOf('row-isound'); S.imute = !S.imute; render(); });
  $('row-isound').addEventListener('click', function () { row = rowOf('row-isound'); render(); });
  ['row-region', 'row-language', 'row-volume', 'row-intro', 'row-glist', 'row-res', 'row-sharpen', 'row-vib', 'row-ct', 'row-sa', 'row-br', 'row-unlock', 'row-boost', 'row-ut', 'row-us', 'row-split'].forEach(function (id) {
    $(id).addEventListener('click', function () { row = rowOf(id); render(); });
  });
  ['row-highlight', 'row-windows', 'row-gpu', 'row-clarity', 'row-stats', 'row-soe', 'row-gpick', 'row-g3d', 'row-social', 'row-ipv6', 'row-mic', 'row-wait', 'row-touch', 'row-up', 'row-splash', 'row-fb', 'row-anim', 'row-ana', 'row-clean', 'row-steady', 'row-pg', 'row-rem', 'row-replay', 'row-alive', 'row-recon', 'row-dnav'].forEach(function (id) {
    $(id).addEventListener('click', function () { row = rowOf(id); change(1); });
  });
  $('row-reload').addEventListener('click', function () { row = rowOf('row-reload'); render(); reload(); });
  $('row-signout').addEventListener('click', function () { row = rowOf('row-signout'); signOut(); });
  $('row-cache').addEventListener('click', function () { row = rowOf('row-cache'); render(); clearCache(); });
  $('row-logs').addEventListener('click', function () { row = rowOf('row-logs'); render(); saveLogs(); });
  $('row-user').addEventListener('click', function () { row = rowOf('row-user'); render(); location.href = '${ACTION_PREFIX}settings-profiles'; });
  $('row-controls').addEventListener('click', function () { row = rowOf('row-controls'); openControls(); });
  $('row-update').addEventListener('click', function () { row = rowOf('row-update'); render(); update(); });
  $('row-net').addEventListener('click', function () { row = rowOf('row-net'); render(); netTest(); });
  $('row-low').addEventListener('click', function () { row = rowOf('row-low'); lowPower(); });
  $('row-backup').addEventListener('click', function () { row = rowOf('row-backup'); render(); backup(); });
  $('row-restore').addEventListener('click', function () { row = rowOf('row-restore'); restore(); });
  $('cback').addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); closeControls(); });
  $('save').addEventListener('click', function (e) { e.preventDefault(); save(); });
  $('cancel').addEventListener('click', function (e) { e.preventDefault(); cancel(); });
  window.addEventListener('load', function () { window.focus(); });
  render();
})();
</script>
</body></html>`;
}

// where to go after the settings screen: back to the welcome screen, or
// close the app (when it was opened from the F1 shortcut)
let settingsReturn = 'welcome';
let settingsWc = null;
function openSettings(wc, returnTo) {
  settingsReturn = returnTo;
  settingsWc = wc;
  log(`settings opened (${returnTo === 'exit' ? 'from the F1 shortcut' : returnTo === 'dashboard' ? 'from the dashboard' : 'from the welcome screen'})`);
  showAppPage(wc, 'luna-settings.html', settingsHtml());
}
function leaveSettings(wc) {
  if (settingsReturn === 'exit') { fastExit('settings closed'); return; }
  // opened from the dashboard (Backspace): straight back to it
  if (settingsReturn === 'dashboard' && isOverlay(wc)) { closeOverlay(); return; }
  showAppPage(wc, 'luna-intro.html', introHtml());
}

// Save the settings screen's choices to config.json, keeping every other setting in it.
function saveSettings(region, volume, highlight, language, intro, asWindows, introVol, introMute, volMute, signOutOnExit, stream) {
  let obj = {};
  try {
    obj = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  } catch (e) {
    if (fs.existsSync(CONFIG)) {
      try { fs.copyFileSync(CONFIG, CONFIG + '.bak'); log('config.json had a mistake; kept a copy as config.json.bak'); } catch (e2) { /* ignore */ }
    }
    obj = {};
  }
  if (region !== 'custom' && REGIONS.some(r => r[0] === region)) {
    obj.start_url = REGION_URL(region);
    cfg.start_url = obj.start_url;
  }
  if (Number.isFinite(volume)) {
    cfg.volume = Math.round(Math.min(100, Math.max(0, volume)));
    obj.volume = cfg.volume;
  }
  if (typeof signOutOnExit === 'boolean') {
    cfg.sign_out_on_exit = signOutOnExit;
    obj.sign_out_on_exit = signOutOnExit;
  }
  if (typeof volMute === 'boolean') {
    cfg.muted = volMute;
    obj.muted = volMute;
  }
  obj.keyboard_highlight = highlight;
  cfg.keyboard_highlight = highlight;
  if (['always', 'daily', 'off'].includes(intro)) {
    cfg.introMode = intro;
    obj.play_intro = intro === 'always' ? true : intro === 'daily' ? 'daily' : false;
  }
  if (Number.isFinite(introVol)) {
    cfg.intro_volume = Math.round(Math.min(100, Math.max(0, introVol)));
    obj.intro_volume = cfg.intro_volume;
  }
  if (typeof introMute === 'boolean') {
    cfg.intro_muted = introMute;
    obj.intro_muted = introMute;
  }
  if (typeof asWindows === 'boolean') {
    cfg.stream_as_windows = asWindows;
    obj.stream_as_windows = asWindows;
  }
  // the stream options
  stream = stream || {};
  if (STREAM_RES.includes(stream.res)) obj.stream_resolution = cfg.stream_resolution = stream.res;
  if (SHARPEN.includes(stream.sharpen)) obj.video_sharpen = cfg.video_sharpen = stream.sharpen;
  for (const [k, q] of [['video_contrast', 'ct'], ['video_saturation', 'sa'], ['video_brightness', 'br']]) {
    if (Number.isFinite(stream[q])) obj[k] = cfg[k] = pictureLevel(stream[q]);
  }
  // GPU acceleration belongs to the machine (it's set as the engine starts):
  // it always goes in config.json, with or without a profile
  let gpuChanged = false;
  if (typeof stream.gpu === 'boolean') {
    gpuChanged = stream.gpu !== cfg.gpu_acceleration;
    obj.gpu_acceleration = cfg.gpu_acceleration = stream.gpu;
  }
  if (typeof stream.clarity === 'boolean') obj.clarity_boost = cfg.clarity_boost = stream.clarity;
  if (typeof stream.stats === 'boolean') obj.stream_stats = cfg.stream_stats = stream.stats;
  if (VIBRATION.includes(stream.vib)) obj.vibration = cfg.vibration = stream.vib;
  if (UNLOCK_CODES.includes(stream.unlock)) obj.region_unlock = cfg.region_unlock = stream.unlock;
  if (BOOST.includes(stream.boost)) obj.audio_boost = cfg.audio_boost = stream.boost;
  if (UP_TARGETS.includes(stream.ut)) obj.upscale_target = cfg.upscale_target = stream.ut;
  if (Number.isFinite(stream.us) && stream.us >= 0 && stream.us <= 100) obj.upscale_sharp = cfg.upscale_sharp = Math.round(stream.us / 10) * 10;
  // split screen belongs to the machine (like GPU acceleration): config.json, next start
  let splitChanged = false;
  if (SPLITS.includes(stream.split)) { splitChanged = stream.split !== cfg.split_players; obj.split_players = cfg.split_players = stream.split; }
  if (typeof stream.rem === 'boolean') { splitChanged = splitChanged || stream.rem !== cfg.split_remember; obj.split_remember = cfg.split_remember = stream.rem; }
  for (const [k, q] of [['no_social', 'social'], ['prefer_ipv6', 'ipv6'], ['mic_on_launch', 'mic'], ['wait_time', 'wait'], ['touch_controller', 'touch'],
    ['upscale_4k', 'up'], ['skip_splash', 'splash'], ['no_feedback', 'fb'], ['reduce_anim', 'anim'], ['no_analytics', 'ana'],
    ['video_cleanup', 'clean'], ['stream_steady', 'steady'], ['picture_per_game', 'pg'],
    ['replay', 'replay'], ['keep_alive', 'alive'], ['auto_reconnect', 'recon']]) {
    if (typeof stream[q] === 'boolean') obj[k] = cfg[k] = stream[q];
  }
  if (language === 'auto' || (language && i18n.STRINGS[language])) {
    cfg.languageChoice = language;
    cfg.language = language === 'auto' ? batoceraLanguage() : language;
    obj.language = language;
  }
  try {
    if (curProfile) {
      // a profile keeps its own choices; config.json stays as it is
      profiles.saveSettings(curProfile.id, {
        start_url: cfg.start_url, language: cfg.languageChoice, volume: cfg.volume, muted: cfg.muted,
        keyboard_highlight: cfg.keyboard_highlight, play_intro: cfg.introMode === 'always' ? true : cfg.introMode === 'daily' ? 'daily' : false,
        intro_volume: cfg.intro_volume, intro_muted: cfg.intro_muted, stream_as_windows: cfg.stream_as_windows, sign_out_on_exit: cfg.sign_out_on_exit,
        stream_resolution: cfg.stream_resolution, video_sharpen: cfg.video_sharpen, clarity_boost: cfg.clarity_boost,
        video_contrast: cfg.video_contrast, video_saturation: cfg.video_saturation, video_brightness: cfg.video_brightness, stream_stats: cfg.stream_stats, vibration: cfg.vibration,
        region_unlock: cfg.region_unlock, audio_boost: cfg.audio_boost, no_social: cfg.no_social, prefer_ipv6: cfg.prefer_ipv6,
        mic_on_launch: cfg.mic_on_launch, wait_time: cfg.wait_time, touch_controller: cfg.touch_controller,
        upscale_4k: cfg.upscale_4k, skip_splash: cfg.skip_splash, no_feedback: cfg.no_feedback, reduce_anim: cfg.reduce_anim, no_analytics: cfg.no_analytics,
        upscale_target: cfg.upscale_target, upscale_sharp: cfg.upscale_sharp, video_cleanup: cfg.video_cleanup, stream_steady: cfg.stream_steady, picture_per_game: cfg.picture_per_game,
        replay: cfg.replay, keep_alive: cfg.keep_alive, auto_reconnect: cfg.auto_reconnect
      });
      if (gpuChanged || splitChanged) {
        let base = {};
        try { base = JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch (e) { /* none or broken: start fresh */ }
        base.gpu_acceleration = cfg.gpu_acceleration;
        base.split_players = cfg.split_players;
        base.split_remember = cfg.split_remember;
        fs.writeFileSync(CONFIG, JSON.stringify(base, null, 2) + '\n');
      }
    } else fs.writeFileSync(CONFIG, JSON.stringify(obj, null, 2) + '\n');
    if (gpuChanged) log(`GPU acceleration turned ${cfg.gpu_acceleration ? 'on' : 'off'}: it applies the next time the app opens`);
    if (splitChanged) log(`split screen ${cfg.split_players ? cfg.split_players + ' players' : 'off'}: it applies the next time the app opens`);
    log(`settings saved: region ${currentRegion()} (${lunaHost()}), language ${cfg.languageChoice === 'auto' ? `same as Batocera (${cfg.language})` : cfg.language}, intro ${cfg.introMode} (sound ${cfg.intro_muted ? 'muted' : cfg.intro_volume + '%'}), sharpening ${cfg.video_sharpen}, clarity boost ${cfg.clarity_boost ? 'on' : 'off'}, picture ${cfg.video_contrast}/${cfg.video_saturation}/${cfg.video_brightness}%, stream stats ${cfg.stream_stats ? 'on' : 'off'}, GPU acceleration ${cfg.gpu_acceleration ? 'on' : 'off'}, volume ${cfg.volume}%${cfg.muted ? ' (muted)' : ''}, key highlights ${highlight ? 'on' : 'off'}`);
  } catch (e) {
    log(`could not save settings: ${e.message}`);
  }
}

// "Use EmulationStation controller mapping" is for the whole machine (config.json),
// whoever's profile is playing

// ---------- profile screens: who's playing, PIN pad, "set up profiles?" ----------
const PAGE_CSS = `
  html,body{margin:0;height:100%;background:rgba(0,0,0,.72);color:#eee;font-family:${i18n.FONT_STACK}}
  body{display:flex;align-items:center;justify-content:center}
  @keyframes pop{from{opacity:0;transform:scale(.94)}to{opacity:1;transform:none}}
  @keyframes shake{0%,100%{transform:none}20%,60%{transform:translateX(-12px)}40%,80%{transform:translateX(12px)}}
  .card{animation:pop .22s ease-out;background:#1a1a1a;border:2px solid #2d2d2d;border-top:6px solid #9146ff;border-radius:14px;
        padding:40px 56px;max-width:1100px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.6)}
  h1{margin:0 0 8px;font-size:38px;font-weight:600;color:#fff}
  .sub{margin:0 0 26px;font-size:20px;color:#9a9a9a}
  .hint{margin:26px 0 0;font-size:17px;color:#8a8a8a;min-height:22px}
  .hint.warn{color:#f0a030}
  button{font-family:inherit;cursor:pointer;outline:none}
`;
const LOCK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5zm-3 8V7a3 3 0 0 1 6 0v3H9z"/></svg>';
function profileName(p) { return (p && p.name) || i18n.t(cfg.language, 'pfNew'); }

function profilesHtml() {
  const L = cfg.language;
  const T = (k, v) => i18n.t(L, k, v);
  const tiles = profiles.list.map(p => ({
    id: p.id, name: profileName(p), color: p.color || '#9146ff', lock: needsPinNow(p),
    current: curProfile && p.id === curProfile.id, signedIn: !!p.xuid, pic: gamerpicData(p)
  }));
  const S = { tiles, addLock: profiles.hasPin, T: { remove: T('pfRemove'), hint: T('pfHint'), notSignedIn: T('pfSignIn') } };
  return `<!doctype html>
<html lang="${L}"><head><meta charset="utf-8"><title>Amazon Luna</title>
<style>
  ${i18n.FONT_CSS}${PAGE_CSS}
  .tiles{display:flex;flex-wrap:wrap;gap:26px;justify-content:center;max-width:1000px;margin-top:30px}
  .tile{width:190px;padding:22px 10px 18px;border-radius:16px;background:#242424;border:4px solid transparent;color:#eee}
  .tile.on{border-color:#fff;background:#2e2e2e;transform:scale(1.05)}
  .tile{transition:transform .12s}
  .pic{width:110px;height:110px;border-radius:50%;margin:0 auto 14px;display:flex;align-items:center;justify-content:center;
       font-size:52px;font-weight:700;color:#fff;position:relative}
  .pic.add{background:#2b2b2b;border:3px dashed #777;color:#bbb;box-sizing:border-box}
  .pic img.gp{width:100%;height:100%;border-radius:50%;object-fit:cover;display:block}
  .lock{position:absolute;right:-4px;bottom:-4px;width:38px;height:38px;border-radius:50%;background:#1a1a1a;border:2px solid #777;
        display:flex;align-items:center;justify-content:center;color:#ddd}
  .lock svg{width:20px;height:20px}
  .nm{font-size:22px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .tag{margin-top:6px;font-size:14px;color:#9a9a9a;min-height:18px}
</style></head><body>
<div class="card">
  <h1>${T('pfTitle')}</h1>
  <div class="tiles" id="tiles"></div>
  <p class="hint" id="hint"></p>
</div>
<script>
(function () {
  var S = ${JSON.stringify(S)};
  var P = '${ACTION_PREFIX}';
  var box = document.getElementById('tiles'), hint = document.getElementById('hint');
  var items = S.tiles.concat([{ add: true }]);
  var cur = Math.max(0, S.tiles.findIndex(function (t) { return t.current; }));
  var confirmId = '', confirmUntil = 0, sent = false;
  function go(path) { if (sent) return; sent = true; setTimeout(function () { sent = false; }, 2500); location.href = P + path; }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; }
  function render() {
    box.textContent = '';
    items.forEach(function (t, i) {
      var b = el('button', 'tile' + (i === cur ? ' on' : ''));
      var pic = el('div', 'pic' + (t.add ? ' add' : ''), t.add || t.pic ? (t.add ? '+' : '') : (t.name || '?').trim().charAt(0).toUpperCase());
      if (t.pic) { var im = el('img', 'gp'); im.src = t.pic; im.alt = ''; pic.appendChild(im); }
      if (!t.add) pic.style.background = t.color;
      if (t.add ? S.addLock : t.lock) { var l = el('span', 'lock'); l.innerHTML = '${LOCK_SVG}'; pic.appendChild(l); }
      b.appendChild(pic);
      b.appendChild(el('div', 'nm', t.add ? '${T('pfAdd').replace(/'/g, "\\'")}' : t.name));
      b.appendChild(el('div', 'tag', t.add || t.signedIn ? '' : S.T.notSignedIn));
      b.addEventListener('click', function () { cur = i; render(); choose(); });
      box.appendChild(b);
    });
    var t = items[cur];
    if (confirmId && Date.now() < confirmUntil && t && t.id === confirmId) { hint.textContent = S.T.remove.replace('{name}', t.name); hint.className = 'hint warn'; }
    else { hint.textContent = S.T.hint; hint.className = 'hint'; }
  }
  function choose() { var t = items[cur]; if (t.add) go('profile-add'); else go('profile-pick?id=' + encodeURIComponent(t.id)); }
  function remove() {
    var t = items[cur];
    if (!t || t.add) return;
    if (confirmId === t.id && Date.now() < confirmUntil) { go('profile-remove?id=' + encodeURIComponent(t.id)); return; }
    confirmId = t.id; confirmUntil = Date.now() + 4000; render(); setTimeout(render, 4100);
  }
  window.addEventListener('keydown', function (e) {
    var k = e.key;
    if (k === 'ArrowRight' || k === 'ArrowDown') { cur = (cur + 1) % items.length; confirmId = ''; render(); }
    else if (k === 'ArrowLeft' || k === 'ArrowUp') { cur = (cur - 1 + items.length) % items.length; confirmId = ''; render(); }
    else if (k === 'Enter' || k === ' ' || k === 'NumpadEnter') choose();
    else if (k === 'y' || k === 'Y' || k === 'Delete') remove();
    else if (k === 'Escape' || k === 'Backspace') go('profiles-back');
    else return;
    e.preventDefault();
  });
  render();
})();
</script></body></html>`;
}

// the PIN pad. kind: 'create' (new PIN, typed twice), or what it unlocks
function pinHtml(pend) {
  const L = cfg.language;
  const T = (k, v) => i18n.t(L, k, v);
  const p = pend.id ? profiles.byId(pend.id) : null;
  const create = pend.kind === 'create';
  const title = create ? T('pinCreate') : T('pinTitle');
  const sub = create ? T('pinCreateHelp') : pend.kind === 'add' || pend.kind === 'addperson' ? T('pinForAdd') : pend.kind === 'remove' ? T('pinForRemove', { name: profileName(p) })
    : pend.kind === 'settings' ? T('pinForSettings') : T('pinFor', { name: profileName(p) });
  const S = { create, T: { again: T('pinAgain'), mismatch: T('pinMismatch'), wrong: T('pinWrong'), hint: create ? T('pinHintCreate') : T('pinHint'), forgot: create ? '' : T('pinForgot') } };
  return `<!doctype html>
<html lang="${L}"><head><meta charset="utf-8"><title>Amazon Luna</title>
<style>
  ${i18n.FONT_CSS}${PAGE_CSS}
  .card{min-width:520px}
  .dots{display:flex;gap:22px;justify-content:center;margin:0 0 28px}
  .dot{width:26px;height:26px;border-radius:50%;border:3px solid #888;box-sizing:border-box}
  .dot.full{background:#fff;border-color:#fff}
  .dots.bad{animation:shake .4s}
  .pad{display:grid;grid-template-columns:repeat(3,96px);gap:14px;justify-content:center}
  .key{height:76px;border-radius:12px;background:#2b2b2b;border:3px solid #555;color:#fff;font-size:30px;font-weight:600}
  .key.small{font-size:19px}
  .key.ok{background:#9146ff;border-color:#9146ff}
  .key.on{outline:4px solid #fff;outline-offset:3px}
  .msg{min-height:26px;margin:-12px 0 16px;font-size:19px;color:#f0a030}
  .forgot{margin:14px 0 0;font-size:15px;color:#6f6f6f}
</style></head><body>
<div class="card">
  <h1>${title}</h1>
  <p class="sub" id="sub">${sub.replace(/</g, '&lt;')}</p>
  <div class="dots" id="dots"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
  <div class="msg" id="msg"></div>
  <div class="pad" id="pad"></div>
  <p class="hint" id="hint"></p>
  <p class="forgot" id="forgot"></p>
</div>
<script>
(function () {
  var S = ${JSON.stringify(S)};
  var P = '${ACTION_PREFIX}';
  var KEYS = ['1','2','3','4','5','6','7','8','9','del','0','ok'];
  var LBL = { del: '${T('pinDel').replace(/'/g, "\\'")}', ok: '${T('pinOk').replace(/'/g, "\\'")}' };
  var code = '', first = '', cur = 0, sent = false;
  var dots = document.getElementById('dots'), msg = document.getElementById('msg'), pad = document.getElementById('pad');
  document.getElementById('hint').textContent = S.T.hint;
  document.getElementById('forgot').textContent = S.T.forgot;
  function go(path) { if (sent) return; sent = true; setTimeout(function () { sent = false; }, 2500); location.href = P + path; }
  function render() {
    Array.prototype.forEach.call(dots.children, function (d, i) { d.className = 'dot' + (i < code.length ? ' full' : ''); });
    pad.textContent = '';
    KEYS.forEach(function (k, i) {
      var b = document.createElement('button');
      b.className = 'key' + (LBL[k] ? ' small' : '') + (k === 'ok' ? ' ok' : '') + (i === cur ? ' on' : '');
      b.textContent = LBL[k] || k;
      b.addEventListener('click', function () { cur = i; press(k); });
      pad.appendChild(b);
    });
  }
  function bad(text) {
    msg.textContent = text; code = '';
    dots.classList.remove('bad'); void dots.offsetWidth; dots.classList.add('bad');
    render();
  }
  function submit() {
    if (code.length < 4) return;
    if (!S.create) { go('pin-check?code=' + code); return; }
    if (!first) { first = code; code = ''; msg.textContent = S.T.again; render(); return; }
    if (first !== code) { first = ''; bad(S.T.mismatch); return; }
    go('pin-create?code=' + code);
  }
  function press(k) {
    if (k === 'del') { code = code.slice(0, -1); render(); return; }
    if (k === 'ok') { submit(); return; }
    if (code.length < 4) { code += k; if (!S.create || first) msg.textContent = msg.textContent === S.T.again ? S.T.again : ''; render(); }
    if (code.length === 4) setTimeout(submit, 120);
  }
  window.__pinWrong = function () { sent = false; bad(S.T.wrong); };
  window.addEventListener('keydown', function (e) {
    var k = e.key;
    if (/^[0-9]$/.test(k)) press(k);
    else if (k === 'Backspace') press('del');
    else if (k === 'Enter' || k === ' ' || k === 'NumpadEnter') press(KEYS[cur]);
    else if (k === 'ArrowRight') cur = cur % 3 === 2 ? cur - 2 : cur + 1;
    else if (k === 'ArrowLeft') cur = cur % 3 === 0 ? cur + 2 : cur - 1;
    else if (k === 'ArrowDown') cur = (cur + 3) % 12;
    else if (k === 'ArrowUp') cur = (cur + 9) % 12;
    else if (k === 'x' || k === 'X') press('del');
    else if (k === 'Escape') { go('pin-cancel'); return; }
    else return;
    e.preventDefault();
    render();
  });
  render();
})();
</script></body></html>`;
}

// "Set up profiles?" when a different person signs in
function promptHtml(person) {
  const L = cfg.language;
  const T = (k, v) => i18n.t(L, k, v);
  // words like "sign-in" don't split across lines
  const q = T('setupQ', { name: (person && person.name) || T('pfNew') }).replace(/(\w)-(\w)/g, '$1\u2011$2');
  return `<!doctype html>
<html lang="${L}"><head><meta charset="utf-8"><title>Amazon Luna</title>
<style>
  ${i18n.FONT_CSS}${PAGE_CSS}
  .card{max-width:860px}
  .q{font-size:26px;line-height:1.45;margin:0 0 32px;color:#eee}
  .row{display:flex;gap:20px;justify-content:center;flex-wrap:wrap}
  .b{border-radius:10px;padding:16px 30px;font-size:22px;font-weight:600;background:#262626;color:#ddd;border:3px solid #555}
  .b.yes{background:#9146ff;color:#fff;border-color:#9146ff}
  .b.on{outline:4px solid #fff;outline-offset:4px}
</style></head><body>
<div class="card">
  <h1>${T('setupT')}</h1>
  <p class="q">${q.replace(/</g, '&lt;')}</p>
  <div class="row" id="row">
    <button class="b yes" data-a="yes">${T('setupYes')}</button>
    <button class="b" data-a="no">${T('setupNo')}</button>
    <button class="b" data-a="never">${T('setupNever')}</button>
  </div>
</div>
<script>
(function () {
  var P = '${ACTION_PREFIX}';
  var bs = Array.prototype.slice.call(document.querySelectorAll('.b')), cur = 0, sent = false;
  function go(a) { if (sent) return; sent = true; location.href = P + 'setup-answer?a=' + a; }
  function render() { bs.forEach(function (b, i) { b.classList.toggle('on', i === cur); }); }
  bs.forEach(function (b, i) { b.addEventListener('click', function () { cur = i; go(b.getAttribute('data-a')); }); });
  window.addEventListener('keydown', function (e) {
    var k = e.key;
    if (k === 'ArrowRight' || k === 'ArrowDown') cur = (cur + 1) % bs.length;
    else if (k === 'ArrowLeft' || k === 'ArrowUp') cur = (cur + bs.length - 1) % bs.length;
    else if (k === 'Enter' || k === ' ' || k === 'NumpadEnter') { go(bs[cur].getAttribute('data-a')); return; }
    else if (k === 'Escape' || k === 'Backspace') { go('no'); return; }
    else return;
    e.preventDefault(); render();
  });
  render();
})();
</script></body></html>`;
}

// ---- profile pictures (kept from older backups; none are made on Luna) ----
const PICS = path.join(HOME, 'profile-pics');
function gamerpicFile(p) { return path.join(PICS, p.id + '.png'); }
function gamerpicData(p) {
  try { return 'data:image/png;base64,' + fs.readFileSync(gamerpicFile(p)).toString('base64'); } catch (e) { return ''; }
}
// (Xbox had gamerpics to show on "Who's playing?"; Amazon has no picture
// to fetch, so each tile shows its colour and the profile's first letter)
let gamerpicAuth = null;
function fetchGamerpic() { /* nothing to fetch on Luna */ }

// ---- profile screens: what they do ----
let pickerReturn = 'start';      // 'start' (after the welcome screen) or 'settings'
let pickerDone = false;          // the profile screen was shown at start already
let pinPending = null;           // what the PIN pad unlocks
let unlockedId = '';             // the adult profile unlocked with the PIN this time
let promptQueue = [];
let promptCur = null;
// adult profiles (any profile that isn't a child's or a teen's) are behind the PIN
function needsPin(p) { return !!p && profiles.hasPin && !isMinor(p); }
// a child or teen plays here and there's no PIN yet: one has to be made
// before an adult's profile opens
function pinMissing(p) { return !!p && !isMinor(p) && minorsHere() && !profiles.hasPin; }
function needsPinNow(p) { return needsPin(p) && unlockedId !== p.id; }
// (no "Who's playing?" on Luna: one Amazon sign-in for the whole machine)
const PROFILES_ON = false;
function startPickerDue() { return PROFILES_ON && !pickerDone && !SETTINGS_MODE && profiles.count >= 2; }
function showPicker(wc, ret) {
  pickerReturn = ret;
  if (ret === 'start') pickerDone = true;
  log('profile screen shown');
  showAppPage(wc, 'luna-profiles.html', profilesHtml());
}
function showPin(wc, pend) {
  pinPending = pend;
  showAppPage(wc, 'luna-pin.html', pinHtml(pend));
}
function queuePrompt(item) {
  if (SETTINGS_MODE) return;
  promptQueue.push(item);
  tryPrompt();
}
function tryPrompt() {
  if (promptCur || !promptQueue.length || overlay || exiting || !mainWin) return;
  promptCur = promptQueue.shift();
  openOverlay('prompt');
}
function closePrompt() {
  promptCur = null;
  closeOverlay();
}
function finishPicker(wc) {
  if (isOverlay(wc)) closeOverlay();
}
function pickProfile(wc, p) {
  if (!p) { showPicker(wc, pickerReturn); return; }
  if (pinMissing(p)) {
    log(`${profileName(p)} is an adult's profile and a child's or teen's profile is set up: a PIN has to be made first`);
    showPin(wc, { kind: 'create', then: p.id });
    return;
  }
  if (needsPinNow(p)) { showPin(wc, { kind: 'pick', id: p.id }); return; }
  if (!curProfile || p.id !== curProfile.id) switchTo(p, 'picked');
  else {
    profiles.setLast(p.id);
    log(`profile: ${profileName(p)} (picked)`);
    // a game from Batocera's list waits for "who's playing?": open it now
    if (GAME_ID && !gameDone && mainWin) { siteReady = false; openStart(mainWin.webContents); }
  }
  finishPicker(wc);
}
function addProfile(wc) {
  if (!profiles.active) profiles.start({});        // whoever is in the original storage now
  const p = profiles.add({ name: `Player ${profiles.count + 1}` });
  log('profiles: added a new profile; it signs in now');
  switchTo(p, 'new profile');
  finishPicker(wc);
}
function removeProfile(wc, id) {
  const p = profiles.byId(id);
  if (!p) { showPicker(wc, pickerReturn); return; }
  const ses = sessionFor(p);
  try { fs.unlinkSync(gamerpicFile(p)); } catch (e) { /* none */ }
  profiles.remove(id);
  log(`profiles: removed ${profileName(p)}`);
  ses.clearStorageData().catch(() => {});
  if (curProfile && curProfile.id === id) {
    const next = profiles.last();
    switchTo(next, 'the profile in use was removed');
  }
  if (profiles.count) showPicker(wc, pickerReturn);
  else finishPicker(wc);
}
// actions from the profile screens; true when handled
function profileAction(wc, action, q) {
  if (action === 'profile-pick') { pickProfile(wc, profiles.byId(q.get('id'))); return true; }
  // with a child's or teen's profile here and no PIN yet, adding or removing
  // a profile needs one made first (like opening an adult's profile)
  if (action === 'profile-add') {
    if (profiles.hasPin) showPin(wc, { kind: 'add' });
    else if (minorsHere()) { log('adding a profile: a child\'s or teen\'s profile is set up and there is no PIN yet: one has to be made first'); showPin(wc, { kind: 'create', next: { kind: 'add' } }); }
    else addProfile(wc);
    return true;
  }
  if (action === 'profile-remove') {
    if (profiles.hasPin) showPin(wc, { kind: 'remove', id: q.get('id') });
    else if (minorsHere()) { log('removing a profile: a child\'s or teen\'s profile is set up and there is no PIN yet: one has to be made first'); showPin(wc, { kind: 'create', next: { kind: 'remove', id: q.get('id') } }); }
    else removeProfile(wc, q.get('id'));
    return true;
  }
  if (action === 'profiles-back') {
    if (pickerReturn === 'settings') { openSettings(wc, settingsReturn); return true; }
    // at start, a locked profile can't just be kept: pick (with the PIN) instead
    if (needsPinNow(curProfile) || pinMissing(curProfile)) { showPicker(wc, 'start'); return true; }
    // a game from Batocera's list waits for "who's playing?": open it now
    if (GAME_ID && !gameDone && mainWin) { siteReady = false; openStart(mainWin.webContents); }
    finishPicker(wc);
    return true;
  }
  if (action === 'pin-check') {
    const pend = pinPending;
    if (!pend) return true;
    if (!profiles.checkPin(q.get('code') || '')) {
      log('PIN: wrong');
      wc.executeJavaScript('window.__pinWrong && window.__pinWrong()').catch(() => {});
      return true;
    }
    pinPending = null;
    log('PIN: correct');
    if (pend.kind === 'pick') { unlockedId = pend.id; pickProfile(wc, profiles.byId(pend.id)); }
    else if (pend.kind === 'add') addProfile(wc);
    else if (pend.kind === 'remove') removeProfile(wc, pend.id);
    else if (pend.kind === 'settings') { unlockedId = pend.id; openSettings(wc, 'exit'); }
    else if (pend.kind === 'move') { unlockedId = pend.id; closePrompt(); moveSignIn(profiles.byId(pend.id), pend.person); }
    else if (pend.kind === 'addperson') { closePrompt(); setupAnswer('yes', pend.person, true); }
    return true;
  }
  if (action === 'pin-create') {
    const code = String(q.get('code') || '');
    const pend = pinPending;
    pinPending = null;
    if (/^\d{4}$/.test(code) && profiles.setPin(code)) {
      log('PIN created for adult profiles');
      // made while opening an adult's profile: that profile opens now
      if (pend && pend.then) { unlockedId = pend.then; pickProfile(wc, profiles.byId(pend.then)); return true; }
      // made while adding or removing a profile: that goes ahead now
      if (pend && pend.next && pend.next.kind === 'add') { addProfile(wc); return true; }
      if (pend && pend.next && pend.next.kind === 'remove') { removeProfile(wc, pend.next.id); return true; }
      if (curProfile && !isMinor(curProfile)) unlockedId = curProfile.id;
    }
    closePrompt();
    return true;
  }
  if (action === 'pin-cancel') {
    const pend = pinPending;
    pinPending = null;
    if (pend && pend.kind === 'settings') { fastExit('PIN not entered'); return true; }
    if (pend && pend.kind === 'create') {
      // a child or teen plays here: the PIN can't be put off
      if (pend.then || pend.next) { log('PIN not made: back to "who\'s playing?"'); showPicker(wc, pickerReturn); return true; }
      if (minorsHere()) { showPin(wc, pend); return true; }
      closePrompt();
      return true;
    }
    if (pend && (pend.kind === 'move' || pend.kind === 'addperson')) { closePrompt(); undoAdultSignIn(pend.person); return true; }
    showPicker(wc, pickerReturn);
    return true;
  }
  if (action === 'card') {
    const kind = promptCur && promptCur.kind, a = q.get('a');
    if (kind === 'lowpower') {
      try { fs.writeFileSync(LOWPOWER_ASKED, `asked ${new Date().toISOString()}: ${a}\n`); } catch (e) { /* ignore */ }
      if (a === 'yes') applyLowPower(); else log('low-power settings: "No thanks"');
    } else log(`"What's new" card closed`);
    closePrompt();
    return true;
  }
  if (action === 'picktip') {
    if (q.get('a') === 'never') {
      try { fs.writeFileSync(PICK_TIP_HIDDEN, `"Games I pick" how-to hidden on ${new Date().toISOString()}. Delete this file to see it again.\n`); } catch (e) { /* ignore */ }
      log('"Games I pick" how-to: "Don\'t show this again"');
    } else log('"Games I pick" how-to: OK');
    closePrompt();
    return true;
  }
  if (action === 'setup-answer') {
    const cur = promptCur;
    setupAnswer(q.get('a'), cur && cur.person);
    closePrompt();
    return true;
  }
  if (action === 'settings-profiles') { if (PROFILES_ON) showPicker(wc, 'settings'); return true; }
  return false;
}

// ---------- the layer on top of the Luna page ----------
// The intro video, the welcome screen and Settings show in a see-through
// layer over the Luna page, so Luna keeps loading (and stays loaded)
// underneath. While it's up, the Luna page can't see the controller, so a
// button pressed on the welcome screen can't also click something on Luna.
let overlay = null;
let siteReady = false;          // the Luna page (or the "can't connect" page) has loaded
let siteWaiters = [];
function whenSiteReady(fn, maxMs) {
  if (siteReady) { fn(); return; }
  let called = false;
  const once = () => { if (!called) { called = true; fn(); } };
  siteWaiters.push(once);
  setTimeout(once, maxMs);
}
function markSiteReady() {
  siteReady = true;
  const w = siteWaiters; siteWaiters = [];
  w.forEach(fn => fn());
}

// stop (or let go of) the Luna page's view of the controller; it's let go
// only once every button is released, so the press that closed the
// welcome screen doesn't reach Luna
//
// It also puts controllers the browser doesn't recognise into the standard
// Xbox layout. Chromium only knows the layout of controllers on its own list;
// any other (a Steam Deck's controls, many third-party pads) reaches the site
// in the raw Linux order: left stick, LEFT TRIGGER, right stick, right
// trigger, d-pad. Amazon Luna then reads the right stick's left/right
// as up/down, ignores its up/down, and the left trigger swings the camera.
const PAD_FIX = `(function(){
  var lows = {};
  function trig(key, v) {
    // triggers rest at -1 (range -1..1) or at 0 (range 0..1)
    if (lows[key] === undefined || v < lows[key]) lows[key] = v;
    var x = lows[key] < -0.5 ? (v + 1) / 2 : v;
    return x < 0.02 ? 0 : x > 1 ? 1 : x;
  }
  function btn(v) { return { pressed: v > 0.15, touched: v > 0.15, value: v }; }
  window.__lunaFixPad = function (p) {
    if (!p) return p;
    if (window.__lunaPadFix === false) return p;
    if (p.mapping === 'standard' || p.axes.length < 6) return p;
    var a = p.axes, rb = p.buttons, key = p.index + ':' + p.id;
    var lt = trig(key + 'l', a[2]), rt = trig(key + 'r', a[5]);
    var b = [];
    function raw(i) { var x = rb[i]; return x ? { pressed: x.pressed, touched: x.touched, value: x.value } : btn(0); }
    if (rb.length >= 13) {
      // A B X Y LB RB LT RT View Menu L3 R3 (Guide) ... already in order
      for (var i = 0; i < 12; i++) b.push(raw(i));
      b[6] = btn(Math.max(lt, rb[6].value)); b[7] = btn(Math.max(rt, rb[7].value));
    } else {
      // A B X Y LB RB View Menu Guide L3 R3 (the xpad order)
      b = [raw(0), raw(1), raw(2), raw(3), raw(4), raw(5), btn(lt), btn(rt), raw(6), raw(7), raw(9), raw(10)];
    }
    // d-pad: buttons 12-15, from the d-pad axes when it has no buttons of its own
    var hx = a.length >= 8 ? a[6] : 0, hy = a.length >= 8 ? a[7] : 0;
    var hasDpadButtons = rb.length >= 17;
    b.push(hasDpadButtons ? raw(13) : btn(hy < -0.5 ? 1 : 0));
    b.push(hasDpadButtons ? raw(14) : btn(hy > 0.5 ? 1 : 0));
    b.push(hasDpadButtons ? raw(15) : btn(hx < -0.5 ? 1 : 0));
    b.push(hasDpadButtons ? raw(16) : btn(hx > 0.5 ? 1 : 0));
    b.push(rb.length >= 13 ? raw(12) : raw(8));   // Guide
    return {
      id: p.id, index: p.index, connected: p.connected, timestamp: p.timestamp,
      mapping: 'standard', axes: [a[0], a[1], a[3], a[4]], buttons: b,
      vibrationActuator: p.vibrationActuator, hapticActuators: p.hapticActuators
    };
  };
  // Amazon Luna officially takes Xbox and PlayStation controllers only.
  // A Steam controller (the Steam Deck's controls, the Steam Controller) is
  // shown to it as an Xbox controller: buttons in the Xbox layout (the fix
  // above, for one the browser doesn't know), Xbox's name, rumble passed
  // through. The app's own screens still see (and name) the real controller.
  // (Remove this if Amazon starts supporting them.)
  var XBOX_ID = 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)';
  function steam(id) { return /Vendor: *28de|^28de-|steam deck|steam controller|valve/i.test(String(id || '')); }
  window.__lunaShowPad = function (p) {
    if (!p) return p;
    var f = window.__lunaFixPad(p);
    if (!f || f.mapping !== 'standard' || !steam(f.id)) return f;
    var bs = [];
    for (var i = 0; i < 17; i++) { var x = f.buttons[i]; bs.push(x ? { pressed: x.pressed, touched: x.touched, value: x.value } : { pressed: false, touched: false, value: 0 }); }
    return {
      id: XBOX_ID, index: f.index, connected: f.connected, timestamp: f.timestamp,
      mapping: 'standard', axes: Array.prototype.slice.call(f.axes, 0, 4), buttons: bs,
      vibrationActuator: f.vibrationActuator || p.vibrationActuator, hapticActuators: f.hapticActuators || p.hapticActuators
    };
  };
  window.__lunaShownAsXbox = function (p) { return !!p && steam(p.id); };
})();`;
// Amazon's sign-in and account pages may read the controller themselves (they
// newer design has controller navigation). On those pages the app already
// moves, types and presses with the controller, so both reacting at once sent
// you to "Forgot your username?" while typing on the on-screen keyboard.
// Every page except the dashboard (luna.amazon.*) is kept from seeing it.
const NO_PAD = `(function(){
  if (window.__lunaNoPad) return;
  window.__lunaNoPad = 1;
  var none = function () { return [null, null, null, null]; };
  try { Object.defineProperty(Navigator.prototype, 'getGamepads', { value: none, configurable: true, writable: true }); } catch (e) {}
  try { Object.defineProperty(navigator, 'getGamepads', { value: none, configurable: true, writable: true }); } catch (e) {}
  var add = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (t) {
    if (t === 'gamepadconnected' || t === 'gamepaddisconnected') return;
    return add.apply(this, arguments);
  };
  try { Object.defineProperty(window, 'ongamepadconnected', { get: function () { return null; }, set: function () {}, configurable: true }); } catch (e) {}
})();`;
const PAD_EVENTS = `(function(){
  if (window.__lunaPadEvents) return;
  window.__lunaPadEvents = 1;
  // "controller connected" messages carry the controller too: the page gets
  // it the way getGamepads shows it (a Steam controller as an Xbox one).
  var GP = { gamepadconnected: 1, gamepaddisconnected: 1 };
  function show(p) { try { return window.__lunaShowPad ? window.__lunaShowPad(p) : p; } catch (e) { return p; } }
  function wrapEvent(e) {
    // (a stand-in target: the real event's own fields can't be changed through a Proxy of it)
    return new Proxy(Object.create(Object.getPrototypeOf(e)), { get: function (_, k) {
      if (k === 'gamepad') return show(e.gamepad);
      var v = e[k]; return typeof v === 'function' ? v.bind(e) : v;
    } });
  }
  var wrapped = new WeakMap();
  function wrapperOf(fn, make) {
    if (!fn || (typeof fn !== 'function' && typeof fn.handleEvent !== 'function')) return fn;
    var w = wrapped.get(fn);
    if (!w && make) {
      w = function (e) { if (window.__lunaMine && !window.__lunaMine(e.gamepad)) return; var x = wrapEvent(e); return typeof fn === 'function' ? fn.call(this, x) : fn.handleEvent(x); };
      wrapped.set(fn, w);
    }
    return w || fn;
  }
  var add = EventTarget.prototype.addEventListener, rem = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (t, fn) {
    if (GP[t] && this === window) { var a = Array.prototype.slice.call(arguments); a[1] = wrapperOf(fn, true); return add.apply(this, a); }
    return add.apply(this, arguments);
  };
  EventTarget.prototype.removeEventListener = function (t, fn) {
    if (GP[t] && this === window) { var a = Array.prototype.slice.call(arguments); a[1] = wrapperOf(fn, false); return rem.apply(this, a); }
    return rem.apply(this, arguments);
  };
  ['ongamepadconnected', 'ongamepaddisconnected'].forEach(function (name) {
    var h = null, t = name.slice(2);
    function run(e) { if (h) h.call(window, wrapEvent(e)); }
    try {
      Object.defineProperty(window, name, { configurable: true,
        get: function () { return h; },
        set: function (f) { if (h) rem.call(window, t, run); h = typeof f === 'function' ? f : null; if (h) add.call(window, t, run); } });
    } catch (e) { /* left as it is */ }
  });
})();`;
const dashHost = u => { try { return isLunaHost(new URL(u).hostname); } catch (e) { return false; } };
const PAD_GATE = `(function(){
  if (!window.__lunaPadGate) {
    window.__lunaPadGate = 1;
    ${PAD_FIX}
    ${PAD_EVENTS}
    var real = Navigator.prototype.getGamepads;
    // Luna learns about a controller from the "gamepadconnected" event, which
    // the browser sends only once. If that happened while an app screen was
    // up (the controller hidden), Luna found nothing and says "Controller not
    // detected" for good. So each time the controller is handed back, and
    // once after the page has loaded, it's announced to the page again.
    var blockedNow = false;
    function announce(why) {
      if (blockedNow) return;
      var n = 0;
      try {
        Array.prototype.slice.call(real.call(navigator)).forEach(function (p) {
          if (!p || !p.connected) return;
          var ev;
          try { ev = new GamepadEvent('gamepadconnected', { gamepad: p }); }
          catch (e) { ev = new Event('gamepadconnected'); Object.defineProperty(ev, 'gamepad', { value: p }); }
          window.__lunaAnnouncing = true;
          try { window.dispatchEvent(ev); } finally { window.__lunaAnnouncing = false; }
          n++;
        });
      } catch (e) { /* none */ }
      if (n) window.__lunaAnnounced = (window.__lunaAnnounced || 0) + 1, window.__lunaAnnouncedWhy = why;
    }
    // "release": handed back once every button is let go. That's checked here
    // too, not only when Luna asks for the controller: Luna may have stopped
    // asking while it saw none, and would never get it back.
    function anyHeld() {
      try {
        var ps = real.call(navigator);
        for (var i = 0; i < ps.length; i++) { var p = ps[i]; if (p) for (var b = 0; b < p.buttons.length; b++) if (p.buttons[b].pressed) return true; }
      } catch (e) { /* none */ }
      return false;
    }
    function whenLetGo(name) {
      var t = setInterval(function () {
        if (window[name] !== 'release') { clearInterval(t); return; }
        if (!anyHeld()) { clearInterval(t); window[name] = false; }
      }, 50);
    }
    Object.defineProperty(window, '__lunaPadsBlocked', {
      configurable: true,
      get: function () { return blockedNow; },
      set: function (v) { var was = blockedNow; blockedNow = v; if (v === 'release') whenLetGo('__lunaPadsBlocked'); if (was && !v) setTimeout(function () { announce('handed back'); }, 0); }
    });
    // the same when the app's on-screen keyboard on the dashboard lets go of
    // it (Luna saw no controller while typing, and would think it was gone)
    var oskNow = false;
    Object.defineProperty(window, '__lunaOsk', {
      configurable: true,
      get: function () { return oskNow; },
      set: function (v) { var was = oskNow; oskNow = v; if (v === 'release') whenLetGo('__lunaOsk'); if (was && !v) setTimeout(function () { announce('keyboard closed'); }, 0); }
    });
    window.__lunaAnnounce = announce;
    function afterLoad() { setTimeout(function () { announce('page loaded'); }, 2500); }
    if (document.readyState === 'complete') afterLoad(); else window.addEventListener('load', afterLoad);
    // what the controllers really are, before the gate (for the app's checks)
    window.__lunaPadInfo = function () {
      var all = [];
      try { all = Array.prototype.slice.call(real.call(navigator)).filter(function (p) { return p && p.connected; }); } catch (e) { /* none */ }
      return { real: all.map(function (p) { return p.id; }), blocked: window.__lunaPadsBlocked || false, announced: window.__lunaAnnounced || 0, why: window.__lunaAnnouncedWhy || '', focus: document.hasFocus(), visible: document.visibilityState };
    };
    // the app's on-screen touch controller (preload.js): its state is on the
    // page (data-luna-vpad: 17 buttons as 0/1, then 4 stick axes), and Xbox
    // gets it as one more Xbox controller
    var VPAD_ID = 'Xbox 360 Controller (XInput STANDARD GAMEPAD)', vpadTs = 0, vpadUp = false;
    function vpad(slot) {
      var raw = document.documentElement && document.documentElement.getAttribute('data-luna-vpad');
      if (!raw) return null;
      var parts = raw.split('|'), bits = parts[0] || '', ax = (parts[1] || '0,0,0,0').split(',').map(Number);
      var bs = [];
      for (var i = 0; i < 17; i++) { var on = bits.charAt(i) === '1'; bs.push({ pressed: on, touched: on, value: on ? 1 : 0 }); }
      vpadTs = performance.now();
      return { id: VPAD_ID, index: slot, connected: true, timestamp: vpadTs, mapping: 'standard', axes: ax, buttons: bs, vibrationActuator: null, hapticActuators: [] };
    }
    function vpadAnnounce() {
      var p = vpad(3); if (!p) return;
      var ev = new Event('gamepadconnected'); Object.defineProperty(ev, 'gamepad', { value: p });
      try { window.dispatchEvent(ev); } catch (e) { /* ignore */ }
    }
    try {
      new MutationObserver(function () {
        var up = !!document.documentElement.getAttribute('data-luna-vpad');
        if (up && !vpadUp) setTimeout(vpadAnnounce, 0);
        vpadUp = up;
      }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-luna-vpad'] });
    } catch (e) { /* ignore */ }
    // split screen: this player's controller only (the n-th one connected),
    // shown to Xbox as the first
    // (__lunaPadIndex: this player's controller; __lunaPadExclude: player
    // 1's page gets the first controller not taken by the others)
    function mine(list) {
      var idx = window.__lunaPadIndex, ex = window.__lunaPadExclude;
      if (idx == null && !ex) return list;
      var on = Array.prototype.filter.call(list, function (p) { return p && p.connected !== false; });
      var p = null;
      for (var i = 0; i < on.length && !p; i++) if (idx != null ? on[i].index === idx : (ex || []).indexOf(on[i].index) < 0) p = on[i];
      var out = [null, null, null, null];
      if (p) out[0] = p;
      return out;
    }
    window.__lunaMine = function (p) { if (window.__lunaPadIndex == null && !window.__lunaPadExclude) return true; var m = mine(real.call(navigator))[0]; return !!(m && p && m.index === p.index); };
    Navigator.prototype.getGamepads = function () {
      var pads = Array.prototype.map.call(mine(real.call(this)), function (p) { return window.__lunaShowPad(p); });
      if (vpadUp || (document.documentElement && document.documentElement.getAttribute('data-luna-vpad'))) {
        pads = Array.prototype.slice.call(pads);
        while (pads.length < 4) pads.push(null);
        var slot = pads.indexOf(null); if (slot < 0) slot = 3;
        var v = vpad(slot); if (v) pads[slot] = v;
      }
      if (window.__lunaPadsBlocked === 'release') {
        var held = false;
        for (var i = 0; i < pads.length; i++) { var p = pads[i]; if (p) for (var b = 0; b < p.buttons.length; b++) if (p.buttons[b].pressed) held = true; }
        if (!held) window.__lunaPadsBlocked = false;
      }
      // the app's keyboard is open on the dashboard: the controller types
      if (window.__lunaOsk === 'release') {
        var held2 = false;
        for (var j = 0; j < pads.length; j++) { var q = pads[j]; if (q) for (var c = 0; c < q.buttons.length; c++) if (q.buttons[c].pressed) held2 = true; }
        if (!held2) window.__lunaOsk = false;
      }
      return window.__lunaPadsBlocked || window.__lunaOsk ? [null, null, null, null] : pads;
    };
  }
})();`;
// Safety net: with no app screen up, the Luna page must see the controller.
// Every 2 seconds: still hidden (a hand-back that was missed) -> handed back;
// "held" for more than 8 seconds (a button that reads as always pressed) ->
// handed back anyway. What the page sees is logged when it changes.
let padWatchLast = '', padReleaseSince = 0, padAnnounced = 0;
// ---------- quick settings in a game (preload.js draws it) ----------
// Audio and video adjustments over the game: hold LB + RB + View, or F9.
// While it's up, Luna doesn't get the controller. Each change is seen at
// once; they're saved when it closes.
let qpOpen = false;
function qpState() {
  const pc = picCfg(), g = cfg.picture_per_game ? streamingGame() : '';
  return { replay: cfg.replay, stats: cfg.stream_stats, volume: cfg.volume, muted: cfg.muted, boost: cfg.audio_boost, sharpen: pc.video_sharpen, clarity: pc.clarity_boost,
    sa: pc.video_saturation, ct: pc.video_contrast, br: pc.video_brightness,
    x64: X64, up: pc.upscale_4k, upTarget: pc.upscale_target, upSharp: pc.upscale_sharp, clean: pc.video_cleanup, game: g };
}
// what quick settings changes: in cfg, or (Picture settings per game) in the game's own settings
let qpGamePic = null;
function qpPic() { return qpGamePic || cfg; }
function qpSave() {
  if (qpGamePic) {
    const g = qpGamePic.__game, all = gamePics(), own = all[picOwner()] = all[picOwner()] || {};
    own[g] = Object.fromEntries(PIC_KEYS.map(k => [k, qpGamePic[k]]));
    try { fs.writeFileSync(GAME_PIC, JSON.stringify(all, null, 2) + '\n'); log(`picture settings saved for this game (${g})`); } catch (e) { log(`couldn't save this game's picture settings: ${e.message}`); }
    qpGamePic = null;
  }
  saveCurrent();
}
// everything as it is now, saved (for the current profile, or config.json)
function saveCurrent() {
  saveSettings(currentRegion(), cfg.volume, cfg.keyboard_highlight, cfg.languageChoice, cfg.introMode, cfg.stream_as_windows,
    cfg.intro_volume, cfg.intro_muted, cfg.muted, cfg.sign_out_on_exit,
    { res: cfg.stream_resolution, sharpen: cfg.video_sharpen, clarity: cfg.clarity_boost, ct: cfg.video_contrast, sa: cfg.video_saturation, br: cfg.video_brightness,
      stats: cfg.stream_stats, vib: cfg.vibration, gpu: cfg.gpu_acceleration, unlock: cfg.region_unlock, boost: cfg.audio_boost, social: cfg.no_social,
      ipv6: cfg.prefer_ipv6, mic: cfg.mic_on_launch, wait: cfg.wait_time, touch: cfg.touch_controller,
      up: cfg.upscale_4k, splash: cfg.skip_splash, fb: cfg.no_feedback, anim: cfg.reduce_anim, ana: cfg.no_analytics,
      ut: cfg.upscale_target, us: cfg.upscale_sharp, clean: cfg.video_cleanup, steady: cfg.stream_steady, pg: cfg.picture_per_game, split: cfg.split_players,
      rem: cfg.split_remember, replay: cfg.replay, alive: cfg.keep_alive, recon: cfg.auto_reconnect });
}
ipcMain.on('luna-qp', (event, open) => {
  qpOpen = !!open;
  const wc = event.sender;
  wc.executeJavaScript(`${PAD_GATE} window.__lunaPadsBlocked = ${qpOpen ? 'true' : "'release'"};`).catch(() => { /* page between loads */ });
  if (qpOpen) {
    const g = cfg.picture_per_game ? streamingGame() : '';
    qpGamePic = g ? Object.assign({ __game: g }, picCfg()) : null;
    log(`quick settings opened in a game${g ? ` (picture settings for ${g})` : ''}`);
    try { fs.writeFileSync(QP_HINT_FILE, String(QP_HINT_MAX)); } catch (e) { /* ignore */ }
    try { wc.send('luna-qp-state', qpState()); } catch (e) { /* ignore */ }
  }
  else { log('quick settings closed'); qpSave(); }
});
// a screenshot from quick settings (or PrintScreen): a PNG of the game's
// picture with the picture settings in it, in Batocera's screenshots folder
const SHOTS_DIR = process.env.LUNA_SHOTS_DIR || '/userdata/screenshots';
ipcMain.on('luna-shot', (event, m) => {
  const wc = event.sender;
  try {
    const data = String((m && m.png) || '');
    if (!/^data:image\/png;base64,/.test(data) || data.length > 60 * 1024 * 1024) throw new Error('no picture');
    fs.mkdirSync(SHOTS_DIR, { recursive: true });
    const d = new Date(), z = n => String(n).padStart(2, '0');
    const name = `luna-${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}.png`;
    fs.writeFileSync(path.join(SHOTS_DIR, name), Buffer.from(data.split(',')[1], 'base64'));
    log(`screenshot saved: ${path.join(SHOTS_DIR, name)} (${m.w}x${m.h})`);
    wc.send('luna-toast', i18n.t(cfg.language, 'shotDone', { f: name }), 3000);
  } catch (e) {
    log(`screenshot not saved: ${e.message}`);
    try { wc.send('luna-toast', i18n.t(cfg.language, 'shotFail'), 3000); } catch (e2) { /* ignore */ }
  }
});
// "Hold LB + RB + View: quick settings" as a game starts, the first few
// times; never again once quick settings has been opened
const QP_HINT_FILE = path.join(HOME, 'quick-hint-count'), QP_HINT_MAX = 5;
ipcMain.on('luna-qp-hint', event => {
  let n = 0;
  try { n = parseInt(fs.readFileSync(QP_HINT_FILE, 'utf8'), 10) || 0; } catch (e) { /* none yet */ }
  if (n >= QP_HINT_MAX) return;
  try { fs.writeFileSync(QP_HINT_FILE, String(n + 1)); } catch (e) { /* ignore */ }
  try { event.sender.send('luna-qp-hint-show', 1); } catch (e) { /* ignore */ }
});
ipcMain.on('luna-qp-set', (event, m) => {
  const k = m && m.k, v = m && m.v, n = Number(v);
  if (k === 'volume' && Number.isFinite(n)) { cfg.volume = Math.round(Math.min(100, Math.max(0, n))); cfg.muted = false; }
  else if (k === 'boost' && BOOST.includes(n)) cfg.audio_boost = n;
  else if (k === 'stats') cfg.stream_stats = v === true;
  else if (k === 'sharpen' && SHARPEN.includes(v)) qpPic().video_sharpen = v;
  else if (k === 'clarity') qpPic().clarity_boost = v === true;
  else if (k === 'sa' || k === 'ct' || k === 'br') qpPic()[{ sa: 'video_saturation', ct: 'video_contrast', br: 'video_brightness' }[k]] = pictureLevel(n);
  else if (k === 'up' && X64) qpPic().upscale_4k = v === true;
  else if (k === 'upTarget' && UP_TARGETS.includes(v)) qpPic().upscale_target = v;
  else if (k === 'upSharp' && Number.isFinite(n)) qpPic().upscale_sharp = Math.round(Math.min(100, Math.max(0, n)) / 10) * 10;
  else if (k === 'clean') qpPic().video_cleanup = v === true;
  else return;
  // per game: the stream gets the game's settings straight away
  if (qpGamePic) {
    const all = gamePics(), own = all[picOwner()] = all[picOwner()] || {};
    own[qpGamePic.__game] = Object.fromEntries(PIC_KEYS.map(q => [q, qpGamePic[q]]));
    try { fs.writeFileSync(GAME_PIC, JSON.stringify(all, null, 2) + '\n'); } catch (e) { /* saved on close */ }
  }
  applyStreamOptions(event.sender);
  if (k === 'volume') { try { event.sender.send('luna-volume', appVolume()); } catch (e) { /* ignore */ } }
});
function padWatch() {
  const wc = mainWin && mainWin.webContents;
  if (!wc || wc.isDestroyed() || SETTINGS_MODE) return;
  let host = '';
  try { host = new URL(wc.getURL()).hostname; } catch (e) { return; }
  if (!isLunaHost(host)) return;
  wc.executeJavaScript('window.__lunaPadInfo ? window.__lunaPadInfo() : null').then(info => {
    if (!info) return;
    const state = `${info.real.length ? info.real.join(', ') : 'none'} | hidden from Luna: ${info.blocked} | page focused: ${info.focus} | ${info.visible}`;
    if (state !== padWatchLast) { padWatchLast = state; log(`controllers on the Luna page: ${state}${overlay ? ' (an app screen is up)' : ''}`); }
    if (info.announced > padAnnounced) log(`controller announced to the Luna page again (${info.why})`);
    padAnnounced = info.announced;
    if (overlay || qpOpen) { padReleaseSince = 0; return; }
    if (info.blocked === true) {
      log('controller was still hidden from Luna with no app screen up: handing it back');
      wc.executeJavaScript("window.__lunaPadsBlocked = 'release';").catch(() => {});
      padReleaseSince = Date.now();
    } else if (info.blocked === 'release') {
      if (!padReleaseSince) padReleaseSince = Date.now();
      else if (Date.now() - padReleaseSince > 8000) {
        log('a controller button reads as held down: handing the controller to Luna anyway');
        wc.executeJavaScript('window.__lunaPadsBlocked = false;').catch(() => {});
        padReleaseSince = 0;
      }
    } else padReleaseSince = 0;
    if (!info.focus && !overlay && info.real.length) { try { mainWin.focus(); wc.focus(); } catch (e) { /* ignore */ } }
  }).catch(() => { /* page between loads */ });
}
function setPadsBlocked(blocked) {
  const wc = mainWin && mainWin.webContents;
  if (!wc) return;
  const state = blocked ? 'true' : "'release'";
  wc.executeJavaScript(`${PAD_GATE} window.__lunaPadsBlocked = ${state};`).catch(() => { /* page between loads */ });
  try { wc.send('luna-overlay', blocked); } catch (e) { /* ignore */ }
}

function fitOverlay() {
  if (!overlay || !mainWin) return;
  const b = mainWin.getContentBounds();
  overlay.setBounds({ x: 0, y: 0, width: b.width, height: b.height });
}
function openOverlay(what) {
  if (!mainWin) return;
  if (!overlay) {
    overlay = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        autoplayPolicy: 'no-user-gesture-required'
      }
    });
    overlay.setBackgroundColor('#00000000');
    mainWin.contentView.addChildView(overlay);
    fitOverlay();
    guard(overlay.webContents, true);
    overlay.webContents.once('did-finish-load', () => {
      if (mainWin && !mainWin.isVisible()) { mainWin.show(); mainWin.focus(); }
      try { overlay && overlay.webContents.focus(); } catch (e) { /* ignore */ }
    });
  }
  setPadsBlocked(true);
  const wc = overlay.webContents;
  if (what === 'video') showAppPage(wc, 'luna-video.html', videoHtml());
  else if (what === 'settings') openSettings(wc, 'dashboard');
  else if (what === 'profiles') showPicker(wc, 'start');
  else if (what === 'prompt' && promptCur && promptCur.kind === 'pinsetup') showPin(wc, { kind: 'create' });
  else if (what === 'prompt' && promptCur && promptCur.kind === 'movepin') showPin(wc, promptCur.pend);
  else if (what === 'prompt' && promptCur && promptCur.kind === 'picktip') showAppPage(wc, 'luna-picktip.html', pickTipHtml());
  else if (what === 'prompt' && promptCur && (promptCur.kind === 'whatsnew' || promptCur.kind === 'lowpower')) showAppPage(wc, 'luna-prompt.html', cardHtml(promptCur.kind));
  else if (what === 'prompt' && promptCur) showAppPage(wc, 'luna-prompt.html', promptHtml(promptCur.person));
  else showAppPage(wc, 'luna-intro.html', introHtml());
}
function closeOverlay() {
  if (!overlay) return;
  gameDone = true;   // the game picked in Batocera's list has been opened
  const v = overlay;
  overlay = null;
  const finish = () => {
    try { mainWin && mainWin.contentView.removeChildView(v); } catch (e) { /* ignore */ }
    try { v.webContents.close(); } catch (e) { /* ignore */ }
    setPadsBlocked(false);
    try { if (mainWin) { mainWin.focus(); mainWin.webContents.focus(); } } catch (e) { /* ignore */ }
    // anything waiting to ask (set up profiles, create a PIN)
    setTimeout(tryPrompt, 400);
  };
  // a quick fade, then it's gone
  v.webContents.executeJavaScript("document.documentElement.style.transition='opacity .25s';document.documentElement.style.opacity='0';")
    .catch(() => {});
  setTimeout(finish, 260);
}
function isOverlay(wc) { return !!overlay && wc === overlay.webContents; }

// the video finished (or was skipped): once Luna has loaded, pop up the
// welcome screen, or just reveal Luna
let introDone = false;
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function introDue() {
  if (cfg.introMode === 'off') return false;
  if (cfg.introMode === 'always') return true;
  try { return fs.readFileSync(INTRO_LAST, 'utf8').trim() !== today(); } catch (e) { return true; }
}
function afterIntro() {
  if (introDone) return;
  introDone = true;
  log('intro video finished');
  whenSiteReady(() => {
    if (!overlay) return;
    if (welcomeShown()) openOverlay('welcome');
    else if (startPickerDue()) showPicker(overlay.webContents, 'start');
    else closeOverlay();
  }, 8000);
}

function showAppPage(wc, name, html) {
  const file = path.join(app.getPath('userData'), name);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, html);
  } catch (e) {
    log(`could not write ${file}: ${e.message}`);
  }
  wc.loadFile(file).catch(() => { /* a newer navigation replaced it */ });
}

let loadStarted = 0;
function openStart(wc, homeOnly) {
  loadStarted = Date.now();
  // opened from a game in Batocera's list: that game's page, until the person
  // is on Luna (homeOnly: Luna's home for now, while "who's playing?" is up)
  const url = GAME_ID && !gameDone && !homeOnly ? gameUrl(GAME_ID) : cfg.start_url;
  if (url !== cfg.start_url) { log(`opening the game picked in Batocera's list: ${url}`); adsLaunch = { id: GAME_ID, until: Date.now() + 60000, tries: 0 }; }
  wc.loadURL(url).catch(() => { /* errors are handled by did-fail-load */ });
}

// A game picked in Batocera's list opens on its Luna page. Luna has no
// address that starts a game straight away, so the page's own Play button is
// pressed for the person: only on that game's page, within a minute of opening
// it, and only once. If no such button turns up (the game isn't in the
// person's plan, or Luna words it differently), the page is left as it is.
let adsLaunch = null;   // { id, until, tries }: the game waiting for its Play button
const PLAY_WORDS = 'play|play now|resume|continue|jouer|spielen|jetzt spielen|gioca|jugar|jogar|spelen|graj|spela|fortsetzen|reprendre|riprendi|reanudar|continuar|doorgaan|wznów|fortsätt';
const PLAY_CLICK_JS = `(function(){
  var re = new RegExp('^\\s*(' + ${JSON.stringify(PLAY_WORDS)} + ')\\s*$', 'i');
  var els = document.querySelectorAll('button, a, [role="button"]');
  for (var i = 0; i < els.length; i++) {
    var e = els[i], t = ((e.innerText || e.textContent || '').trim() || e.getAttribute('aria-label') || '').replace(/\\s+/g, ' ');
    if (re.test(t) && e.offsetParent !== null && !e.disabled && e.getAttribute('aria-disabled') !== 'true') { e.click(); return t.slice(0, 60); }
  }
  return '';
})()`;
function checkAdsLaunch(wc, url) {
  if (!adsLaunch || Date.now() > adsLaunch.until) { adsLaunch = null; return; }
  const g = gameFromUrl(url);
  if (!g || g.id !== adsLaunch.id) return;             // not the picked game's page
  const want = adsLaunch;
  if (want.looking) return;
  want.looking = true;
  log(`${want.id}'s Luna page opened: looking for its Play button`);
  const look = () => {
    if (adsLaunch !== want || wc.isDestroyed()) return;
    if (overlay) { setTimeout(look, 700); return; }   // "who's playing?" is still up
    if (++want.tries > 30) { log(`no Play button on ${want.id}'s page; left for the person`); adsLaunch = null; return; }
    wc.executeJavaScript(PLAY_CLICK_JS).then(hit => {
      if (hit) { log(`pressed "${hit}" for ${want.id}`); adsLaunch = null; }
      else setTimeout(look, 600);
    }, () => setTimeout(look, 600));
  };
  setTimeout(look, 1500);
}

// "Got it, continue" / "Don't show this again", from any input
let lastContinue = 0;
function doContinue(wc, never, how) {
  const now = Date.now();
  if (now - lastContinue < 1500) return; // the same choice arriving two ways
  lastContinue = now;
  if (never) {
    try {
      fs.writeFileSync(TIP_HIDDEN, `Exit tip hidden on ${new Date().toISOString()}. Delete this file to see it again.\n`);
      log(`start screen: "Don't show this again" (${how}); it won't be shown again`);
    } catch (e) {
      log(`could not save "don't show again": ${e.message}`);
    }
  } else {
    log(`start screen: "Got it, continue" (${how})`);
    // "Got it" means keep showing it at start, even if it was hidden before
    // (the screen can still be opened by holding Menu while playing)
    if (fs.existsSync(TIP_HIDDEN)) {
      try { fs.unlinkSync(TIP_HIDDEN); log('start screen will show at start again'); } catch (e) { /* ignore */ }
    }
  }
  // more than one profile: who's playing? (once, after the welcome screen at start)
  if (isOverlay(wc) && startPickerDue()) showPicker(wc, 'start');
  else if (isOverlay(wc)) closeOverlay();
  else openStart(wc);
}

// actions from the app's own screens (https://luna.invalid/...)
function handleAction(wc, url) {
  let u;
  try { u = new URL(url); } catch (e) { return; }
  const action = u.pathname.replace(/^\/+/, '');
  if (profileAction(wc, action, u.searchParams)) return;
  if (action === 'continue') doContinue(wc, u.searchParams.get('never') === '1', 'keyboard/mouse');
  else if (action === 'retry') { log('retry from the "can\'t connect" screen'); openStart(wc); }
  else if (action === 'intro-done') { log(`intro video: ${u.searchParams.get('why') || 'ended'} (at ${u.searchParams.get('at') || '?'} s)`); afterIntro(); }
  else if (action === 'settings') openSettings(wc, 'welcome');
  else if (action === 'settings-save') {
    const q = u.searchParams;
    const before = cfg.start_url, beforeUA = cleanUserAgent();
    saveSettings(String(q.get('region') || ''), q.has('volume') ? Number(q.get('volume')) : NaN, q.get('highlight') === '1', String(q.get('lang') || ''),
      String(q.get('intro') || ''), q.has('windows') ? q.get('windows') === '1' : undefined,
      q.has('ivol') ? Number(q.get('ivol')) : NaN, q.has('imute') ? q.get('imute') === '1' : undefined,
      q.has('vmute') ? q.get('vmute') === '1' : undefined, q.has('soe') ? q.get('soe') === '1' : undefined,
      { res: q.get('res'), gpu: q.has('gpu') ? q.get('gpu') === '1' : undefined, sharpen: q.get('sharpen'), clarity: q.has('clarity') ? q.get('clarity') === '1' : undefined,
        ct: q.has('ct') ? Number(q.get('ct')) : NaN, sa: q.has('sa') ? Number(q.get('sa')) : NaN, br: q.has('br') ? Number(q.get('br')) : NaN, stats: q.has('stats') ? q.get('stats') === '1' : undefined, vib: q.has('vib') ? Number(q.get('vib')) : undefined,
        unlock: q.get('unlock'), boost: q.has('boost') ? Number(q.get('boost')) : undefined,
        social: q.has('social') ? q.get('social') === '1' : undefined, ipv6: q.has('ipv6') ? q.get('ipv6') === '1' : undefined,
        mic: q.has('mic') ? q.get('mic') === '1' : undefined, wait: q.has('wait') ? q.get('wait') === '1' : undefined, touch: q.has('touch') ? q.get('touch') === '1' : undefined,
        up: q.has('up') ? q.get('up') === '1' : undefined, splash: q.has('splash') ? q.get('splash') === '1' : undefined, fb: q.has('fb') ? q.get('fb') === '1' : undefined,
        anim: q.has('anim') ? q.get('anim') === '1' : undefined, ana: q.has('ana') ? q.get('ana') === '1' : undefined,
        ut: q.get('ut'), us: q.has('us') ? Number(q.get('us')) : undefined, clean: q.has('clean') ? q.get('clean') === '1' : undefined,
        steady: q.has('steady') ? q.get('steady') === '1' : undefined, pg: q.has('pg') ? q.get('pg') === '1' : undefined, split: q.has('split') ? Number(q.get('split')) : undefined,
        rem: q.has('rem') ? q.get('rem') === '1' : undefined, replay: q.has('replay') ? q.get('replay') === '1' : undefined,
        alive: q.has('alive') ? q.get('alive') === '1' : undefined, recon: q.has('recon') ? q.get('recon') === '1' : undefined });
    // the stream options change on the dashboard straight away (the resolution from the next game)
    applyStreamOptions(mainWin && mainWin.webContents);
    try { mainWin && mainWin.webContents.send('luna-touch', cfg.touch_controller); } catch (e) { /* ignore */ }
    try { mainWin && mainWin.webContents.send('luna-replay', cfg.replay); } catch (e) { /* ignore */ }
    if (q.has('dnav')) saveDashNav(q.get('dnav') === '1');
    if (q.has('glist')) saveGameList(q);
    // the new volume (or mute) takes effect straight away
    for (const w of BrowserWindow.getAllWindows ? BrowserWindow.getAllWindows() : []) {
      try { w.webContents.send('luna-volume', appVolume()); } catch (e) { /* ignore */ }
    }
    const uaChanged = cleanUserAgent() !== beforeUA;
    if (uaChanged) applyUserAgent();
    // the Luna page's keyboard and messages switch language straight away
    try { mainWin && mainWin.webContents.send('luna-lang', preloadText()); } catch (e) { /* ignore */ }
    if ((cfg.start_url !== before || uaChanged) && !SETTINGS_MODE && mainWin) { siteReady = false; openStart(mainWin.webContents); }
    leaveSettings(wc);
  }
  else if (action === 'settings-cancel') { log('settings closed without saving'); leaveSettings(wc); }
  else if (action === 'settings-signout') {
    log('signed out of Amazon from Settings');
    ageGroupSeen = '';
    if (curProfile) profiles.update(curProfile, { xuid: '', age: '' });
    identitySeen = ''; signedInLogged = null;
    const ses = curSession();
    Promise.resolve()
      .then(() => ses.clearStorageData())
      .then(() => ses.clearCache())
      .catch(e => log(`sign out: ${e.message}`))
      .then(() => {
        if (SETTINGS_MODE || !mainWin) { fastExit('signed out'); return; }
        siteReady = false;
        openStart(mainWin.webContents);
        if (isOverlay(wc)) closeOverlay(); else leaveSettings(wc);
      });
  }
  else if (action === 'settings-reload') {
    if (SETTINGS_MODE || !mainWin) { leaveSettings(wc); return; }
    log('dashboard reloaded from Settings');
    siteReady = false;
    openStart(mainWin.webContents);
    if (isOverlay(wc)) closeOverlay(); else leaveSettings(wc);
  }
  else if (action === 'settings-clear-cache') clearAppCache(wc);
  else if (action === 'settings-logs') saveSupportLogs(wc);
  else if (action === 'settings-backup') makeBackup(wc);
  else if (action === 'settings-restore') restoreBackup(wc, u.searchParams.get('f'));
  else if (action === 'settings-update-check') checkForUpdates();
  else if (action === 'settings-nettest') runNetTest(wc);
  else if (/^join-(pad|pick|leave)$/.test(action)) joinAction(wc, action, u.searchParams);
  else if (action === 'quit') fastExit('app screen');
}

// ---------- Back up and restore (Settings > Help and maintenance) ----------
// One file in the share folder, luna-backup-<date>.json: config.json, the
// profiles (names, ages, colours, gamerpics, their settings, the PIN's hash),
// each profile's per-game picture settings and the picked games. Not the
// Amazon sign-ins: after restoring on another machine, each profile signs in again.
const BACKUP_RE = /^luna-backup-[\w-]+\.json$/;
const BACKUP_FILES = /^(config\.json|profiles\.json|pin|children-mode|game-picture\.json|picked-games\.json|profile-settings\/p\d+\.json|profile-pics\/p\d+\.png)$/;
function newestBackup() {
  try {
    const list = fs.readdirSync(SHARE).filter(f => BACKUP_RE.test(f) && !/before-restore/.test(f))
      .map(f => ({ f, t: fs.statSync(path.join(SHARE, f)).mtimeMs })).sort((a, b) => b.t - a.t);
    return list[0] || null;
  } catch (e) { return null; }
}
function backupData() {
  const files = {};
  const add = rel => { try { files[rel] = fs.readFileSync(path.join(HOME, rel)).toString('base64'); } catch (e) { /* not there */ } };
  ['config.json', 'profiles.json', 'pin', 'children-mode', 'game-picture.json', 'picked-games.json'].forEach(add);
  for (const dir of ['profile-settings', 'profile-pics']) {
    try { fs.readdirSync(path.join(HOME, dir)).forEach(f => { if (BACKUP_FILES.test(`${dir}/${f}`)) add(`${dir}/${f}`); }); } catch (e) { /* none */ }
  }
  return { app: 'luna-backup', version: VERSION, saved: new Date().toISOString(), files };
}
function writeBackup(name) {
  const data = backupData();
  fs.writeFileSync(path.join(SHARE, name), JSON.stringify(data, null, 1) + '\n');
  return Object.keys(data.files).length;
}
function makeBackup(wc) {
  const done = r => { if (wc && !wc.isDestroyed()) wc.executeJavaScript(`window.__backupStatus && window.__backupStatus(${JSON.stringify(r)})`).catch(() => {}); };
  try {
    const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
    const name = `luna-backup-${stamp}.json`;
    const n = writeBackup(name);
    log(`settings backed up: ${path.join(SHARE, name)} (${n} files)`);
    done({ f: name, t: Date.now() });
  } catch (e) { log(`couldn't back up the settings: ${e.message}`); done(null); }
}
function restoreBackup(wc, name) {
  const done = ok => { if (wc && !wc.isDestroyed()) wc.executeJavaScript(`window.__restoreStatus && window.__restoreStatus(${ok})`).catch(() => {}); };
  try {
    if (!BACKUP_RE.test(String(name || ''))) throw new Error('not a backup file name');
    const data = JSON.parse(fs.readFileSync(path.join(SHARE, name), 'utf8'));
    if (!data || data.app !== 'luna-backup' || !data.files || typeof data.files !== 'object') throw new Error('not an Amazon Luna backup');
    const files = Object.entries(data.files).filter(([rel, b64]) => BACKUP_FILES.test(rel) && typeof b64 === 'string');
    if (!files.some(([rel]) => rel === 'config.json' || rel === 'profiles.json')) throw new Error('the backup has no settings in it');
    // what's here now, kept just in case
    const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
    try { writeBackup(`luna-backup-before-restore-${stamp}.json`); } catch (e) { /* ignore */ }
    // out with the old profile files, in with the backup's
    for (const rel of ['profiles.json', 'pin', 'children-mode', 'game-picture.json', 'picked-games.json']) { try { fs.unlinkSync(path.join(HOME, rel)); } catch (e) { /* none */ } }
    for (const dir of ['profile-settings', 'profile-pics']) {
      try { fs.readdirSync(path.join(HOME, dir)).forEach(f => { try { fs.unlinkSync(path.join(HOME, dir, f)); } catch (e) { /* ignore */ } }); } catch (e) { /* none */ }
    }
    for (const [rel, b64] of files) {
      const to = path.join(HOME, rel);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.writeFileSync(to, Buffer.from(b64, 'base64'));
    }
    log(`settings restored from ${name} (saved ${data.saved}, v${data.version}, ${files.length} files): the app closes so they're used from the start`);
    done(true);
    setTimeout(() => fastExit('settings restored'), 3500);
  } catch (e) { log(`couldn't restore ${name}: ${e.message}`); done(false); }
}

// ---------- Safe mode ----------
// Hold LB + RB while the app opens (or start it with --safe): the picture
// options that lean on the graphics chip go off, so a black or broken
// picture can be fixed without a terminal. GPU acceleration and split
// screen are set as the engine starts, so if they were on, the app closes
// and is opened again as usual.
let safeDone = false;
function safeMode(how) {
  if (safeDone) return;
  safeDone = true;
  const changed = [];
  const set = (k, v) => { if (cfg[k] !== v) { cfg[k] = v; changed.push(k); } };
  set('upscale_4k', false); set('video_cleanup', false); set('video_sharpen', 'off'); set('clarity_boost', false);
  for (const k of PICTURE) set(k, 100);
  set('stream_steady', false); set('picture_per_game', false);
  const restart = GPU_AT_START || SPLIT_AT_START > 0;
  if (SAFE_ARG) changed.push('gpu_acceleration (off for --safe)');
  cfg.gpu_acceleration = false; cfg.split_players = 0;
  try {
    saveCurrent();
    let base = {};
    try { base = JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch (e) { /* none */ }
    if (base.gpu_acceleration || base.split_players) {
      base.gpu_acceleration = false; base.split_players = 0;
      fs.writeFileSync(CONFIG, JSON.stringify(base, null, 2) + '\n');
    }
  } catch (e) { log(`safe mode: couldn't save: ${e.message}`); }
  log(`safe mode (${how}): ${restart ? 'GPU acceleration / split screen off, ' : ''}${changed.length ? changed.join(', ') + ' off' : 'nothing else was on'}`);
  if (restart) {
    mainToast('safeClose', null, 6000);
    setTimeout(() => fastExit('safe mode: open the app again'), 6000);
    return;
  }
  mainToast(changed.length ? 'safeOn' : 'safeNone', null, 6000);
  try { if (mainWin) applyStreamOptions(mainWin.webContents); } catch (e) { /* ignore */ }
}
ipcMain.on('luna-safe', () => {
  if (Date.now() - APP_START > 45 * 1000) { log('LB + RB held, but not as the app opened: no safe mode'); return; }
  safeMode('LB + RB held as the app opened');
});

// ---------- Low-power settings, and the one-time cards ----------
const LOWPOWER_ASKED = path.join(HOME, 'lowpower-asked');
const WHATSNEW_DUE = path.join(HOME, 'whats-new-due');
function applyLowPower() {
  cfg.reduce_anim = true; cfg.no_analytics = true; cfg.no_social = true;
  cfg.upscale_4k = false; cfg.video_cleanup = false; cfg.video_sharpen = 'off'; cfg.clarity_boost = false; cfg.replay = false;
  saveCurrent();
  log('low-power settings turned on');
  try { if (mainWin) applyStreamOptions(mainWin.webContents); } catch (e) { /* ignore */ }
  mainToast('lpDone', null, 6000);
}
function cardHtml(kind) {
  const L = cfg.language;
  const T = (k, v) => i18n.t(L, k, v).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const wn = kind === 'whatsnew';
  const body = wn ? `<ul>${['wn1', 'wn2', 'wn3', 'wn4', 'wn5', 'wn6'].map(k => `<li>${T(k)}</li>`).join('')}</ul>` : `<p class="q">${T('lpQ')}</p>`;
  const btns = wn ? [['ok', T('pinOk'), true]] : [['yes', T('lpYes'), true], ['no', T('lpNo'), false]];
  return `<!doctype html>
<html lang="${L}"><head><meta charset="utf-8"><title>Amazon Luna</title>
<style>
  ${i18n.FONT_CSS}${PAGE_CSS}
  .card{max-width:1000px;text-align:left}
  h1{text-align:center;margin-bottom:24px}
  ul{margin:0 0 30px;padding:0;list-style:none}
  li{position:relative;padding-left:34px;font-size:23px;line-height:1.4;color:#eee;margin:0 0 14px}
  li:before{content:'';position:absolute;left:4px;top:11px;width:14px;height:14px;border-radius:50%;background:#9146ff}
  .q{font-size:24px;line-height:1.45;margin:0 0 32px;color:#eee}
  .row{display:flex;gap:20px;justify-content:center}
  .b{border-radius:10px;padding:16px 34px;font-size:22px;font-weight:600;background:#262626;color:#ddd;border:3px solid #555}
  .b.yes{background:#9146ff;color:#fff;border-color:#9146ff}
  .b.on{outline:4px solid #fff;outline-offset:4px}
</style></head><body>
<div class="card" data-card="${kind}">
  <h1>${wn ? T('wnT', { v: VERSION }) : T('lpT')}</h1>
  ${body}
  <div class="row">${btns.map(([a, t, y]) => `<button class="b${y ? ' yes' : ''}" data-a="${a}">${t}</button>`).join('')}</div>
</div>
<script>
(function () {
  var P = '${ACTION_PREFIX}';
  var bs = Array.prototype.slice.call(document.querySelectorAll('.b')), cur = 0, sent = false;
  function go(a) { if (sent) return; sent = true; location.href = P + 'card?a=' + a; }
  function render() { bs.forEach(function (b, i) { b.classList.toggle('on', i === cur); }); }
  bs.forEach(function (b, i) { b.addEventListener('click', function () { cur = i; go(b.getAttribute('data-a')); }); });
  window.addEventListener('keydown', function (e) {
    var k = e.key;
    if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowUp') cur = (cur + 1) % bs.length;
    else if (k === 'Enter' || k === ' ' || k === 'NumpadEnter') { go(bs[cur].getAttribute('data-a')); return; }
    else if (k === 'Escape' || k === 'Backspace') { go(bs[bs.length - 1].getAttribute('data-a')); return; }
    else return;
    e.preventDefault(); render();
  });
  render();
})();
</script></body></html>`;
}

// ---------- Clear cache ----------
// Stored copies of pages, pictures and scripts, the graphics (shader) cache
// and compiled-script cache. Sign-in (cookies, saved site data) is kept.
function clearAppCache(wc) {
  const ses = curSession();
  let bytes = 0;
  Promise.resolve()
    .then(() => (ses.getCacheSize ? ses.getCacheSize() : 0)).then(n => { bytes = Number(n) || 0; })
    .then(() => ses.clearCache())
    .then(() => ses.clearStorageData({ storages: ['shadercache'] }))
    .then(() => (ses.clearCodeCaches ? ses.clearCodeCaches({}) : null))
    .catch(e => log(`clear cache: ${e.message}`))
    .then(() => {
      const mb = Math.max(1, Math.round(bytes / (1024 * 1024)));
      log(`cache cleared (${mb} MB)`);
      if (wc && !wc.isDestroyed()) wc.executeJavaScript(`window.__cacheStatus && window.__cacheStatus(${mb})`).catch(() => {});
    });
}

// ---------- Batocera game list ----------
// Settings > Batocera game list: the cloud games themselves in Batocera's
// Luna list (all of them, or the ones picked here), each with its art
// and description, done by Sync-GameList.py. Picking one there opens the app
// with --luna-game=<its Luna ID> (the 10-letter ID in its address, B0...).
const GAME_ID = ((process.argv.find(a => a.startsWith('--luna-game=')) || '').split('=')[1] || '').toUpperCase();
const GAME_ID_RE = /^[0-9A-Z]{10}$/;
let gameDone = !GAME_ID_RE.test(GAME_ID);
const SYNC_GAMELIST = path.join(HOME, 'Sync-GameList.py');
const GL_STATE = path.join(HOME, 'gamelist-state.json');
const PICKED_FILE = path.join(HOME, 'picked-games.json');
function glState() { try { return JSON.parse(fs.readFileSync(GL_STATE, 'utf8')) || {}; } catch (e) { return {}; } }
function pickedGames() {
  try { const a = JSON.parse(fs.readFileSync(PICKED_FILE, 'utf8')); return Array.isArray(a) ? a.filter(g => g && g.id) : []; } catch (e) { return []; }
}
const slugify = t => String(t || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'game';
// a game's page on Luna: https://luna.amazon.com/game/<name>/<ID>
function gameUrl(id) {
  const known = (glState().games || {})[id];
  const picked = pickedGames().find(g => g.id === id);
  const slug = picked && picked.slug && !NOT_A_NAME.test(picked.slug) ? picked.slug : (known && known.slug) || slugify(known && known.title);
  return `https://${lunaHost()}/game/${slug}/${id}`;
}
// the game whose page Luna is showing (for "This game in Batocera's list")
function pageGame() {
  let u = '';
  try { u = mainWin && !SETTINGS_MODE ? mainWin.webContents.getURL() : ''; } catch (e) { /* closed */ }
  return gameFromUrl(u);
}
// a game's page on Luna: .../game/<name>/<ID> (also .../web/game/...)
function gameFromUrl(u, pageTitle) {
  let path = '';
  try { const x = new URL(String(u || '')); if (!isLunaHost(x.hostname)) return null; path = x.pathname; } catch (e) { return null; }
  const m = /\/game\/([^/?#]+)\/([0-9A-Za-z]{10})(?:[/?#]|$)/.exec(path);
  if (!m) return null;
  return pageGameFrom(m[1] || '', m[2].toUpperCase(), pageTitle);
}
// words in Luna addresses that aren't a game's name
const NOT_A_NAME = /^(game|games|web|play|home|search|library|my-stuff)$/i;
function pageGameFrom(slug, id, pageTitle) {
  const known = (glState().games || {})[id];
  if (NOT_A_NAME.test(slug || '')) slug = '';
  let title = known && known.title ? known.title : '';
  if (!title && pageTitle) title = pageTitle;
  if (!title && slug) { try { title = decodeURIComponent(slug).replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); } catch (e) { title = slug; } }
  if (!slug && title) slug = slugify(title);
  return { id, slug: slug || 'game', title: title || id };
}
function regionCode() { const r = currentRegion(); return r === 'custom' ? 'en-us' : r; }   // (for the log)
function mainToast(key, vars, ms) {
  const wc = mainWin && mainWin.webContents;
  try { if (wc) wc.send('luna-toast', i18n.t(cfg.language, key, vars), ms || 5000); } catch (e) { /* ignore */ }
}
let glRun = null, glAgain = null;
// how far the game list update has got, 0-100 (null when none is running):
// shown as a bar on the dashboard and in Settings
let glPct = null;
function glProgress(pct) {
  pct = pct == null ? null : Math.max(0, Math.min(100, Math.round(pct)));
  if (pct === glPct) return;
  glPct = pct;
  const text = pct == null ? '' : i18n.t(cfg.language, 'glBusy');
  try { if (mainWin && mainWin.webContents) mainWin.webContents.send('luna-glprogress', pct, text); } catch (e) { /* window closing */ }
  const wc = settingsWc;
  if (wc && !wc.isDestroyed()) wc.executeJavaScript(`window.__glProgress && window.__glProgress(${JSON.stringify(pct)})`).catch(() => { /* Settings closed */ });
}
// a step of the update (one JSON line from Sync-GameList.py) as a share of the whole:
// the list and details 0-15%, the pictures up to 85% (100% without 3D boxes), the 3D boxes the rest
function glStep(m, box3d) {
  const artEnd = box3d ? 85 : 100;
  if (m.stage === 'waiting') return 0;
  if (m.stage === 'list') return 2;
  if (m.stage === 'details') return 6;
  if (m.stage === 'listed') return 15;
  if (m.stage === 'art' && m.total) return 15 + (artEnd - 15) * m.done / m.total;
  if (m.stage === 'boxes' && m.total) return 85 + 15 * m.done / m.total;
  if (m.done === true) return 100;
  return null;
}
// ---- 3D game boxes drawn by the app (when Batocera's Python has no Pillow) ----
const boxTried = new Set();
// the age-rating tile on a 3D box: the same as gamebox3d.py's (the app's own
// design, not a rating board's logo). label as Sync-GameList.py stores it:
// "ESRB T", "PEGI 12", ...
function boxTile(age, label) {
  if (typeof age !== 'number' || !label) return null;
  const [system, ...rest] = String(label).split(' ');
  const value = rest.join(' ');
  let top, bottom;
  if (system === 'ESRB') { top = value === 'E' || value === 'EC' ? 'ALL' : `${age}+`; bottom = value.replace(/\+$/, ''); }
  else { top = age <= 0 ? 'ALL' : `${age}+`; bottom = label.length <= 8 ? label : value; }
  const tiers = [[6, '#3B6D11', '#C0DD97'], [10, '#185FA5', '#B5D4F4'], [13, '#854F0B', '#FAC775'], [16, '#993C1D', '#F0997B'], [17, '#A32D2D', '#F7C1C1']];
  const [, color, rule] = tiers.find(t => age <= t[0]) || [0, '#791F1F', '#F7C1C1'];
  return { top, bottom, color, rule };
}
// the keyboard-and-mouse and touch badges (bottom left of the cover), drawn by gamebox3d.py
function badgeImgs(features) {
  return (features || []).filter(f => f === 'mkb' || f === 'touch').map(f => {
    let b64 = '';
    try { b64 = fs.readFileSync(path.join(HOME, `badge-${f}.png`)).toString('base64'); } catch (e) { return ''; }
    return `<div class="badge"><img alt="" src="data:image/png;base64,${b64}"></div>`;
  }).join('');
}
function boxHtml(coverUrl, logoUrl, title, altUrl, rating, features) {
  const tile = rating ? boxTile(rating.age, rating.label) : null;
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;background:transparent;overflow:hidden}
  body{width:700px;height:1000px;display:flex;align-items:center;justify-content:center;font-family:"DejaVu Sans","Noto Sans",Arial,sans-serif}
  .scene{perspective:2200px;perspective-origin:30% 50%}
  .box{position:relative;width:560px;height:840px;transform-style:preserve-3d;transform:rotateY(24deg);transform-origin:0 50%}
  .front{position:absolute;inset:0;background:#060606;border-radius:14px;overflow:hidden;box-shadow:inset 0 0 0 1px rgba(255,255,255,.12)}
  .head{position:absolute;left:0;right:0;top:0;height:76px;display:flex;align-items:center;gap:13px;padding:0 0 0 30px;background:linear-gradient(#221735,#060606)}
  .head img{width:54px;height:54px;object-fit:contain}
  .head span{color:#fff;font-weight:700;font-size:27px;letter-spacing:.5px;white-space:nowrap}
  .line{position:absolute;left:0;right:0;top:76px;height:5px;background:#9146ff;box-shadow:0 0 14px 4px rgba(145,70,255,.55),inset 0 2px 0 rgba(196,166,255,.9)}
  #art{position:absolute;left:10px;top:81px;width:540px;height:749px;object-fit:cover;background:#000}
  .gloss{position:absolute;inset:0;background:linear-gradient(100deg,rgba(255,255,255,.13) 0%,rgba(255,255,255,0) 45%);pointer-events:none}
  .tile{position:absolute;right:19px;bottom:29px;min-width:91px;box-sizing:border-box;padding:12px 14px 11px;border-radius:15px;border:4px solid #fff;color:#fff;text-align:center;line-height:1;box-shadow:3px 6px 14px rgba(0,0,0,.45)}
  .tile b{display:block;font-size:40px;font-weight:700}
  .tile i{display:block;height:3px;margin:10px 0}
  .tile span{display:block;font-size:28px;font-weight:700;color:#faf8f0}
  .tile span.long{font-size:21px}
  .badges{position:absolute;left:19px;bottom:29px;display:flex;gap:12px}
  .badge{width:92px;height:92px;box-sizing:border-box;border-radius:15px;border:4px solid #fff;background:#161616;display:flex;align-items:center;justify-content:center;box-shadow:3px 6px 14px rgba(0,0,0,.45)}
  .badge img{width:70px;height:70px}
  .spine{position:absolute;left:-52px;top:0;width:52px;height:840px;border-radius:9px;overflow:hidden;transform-origin:100% 50%;transform:rotateY(-90deg);background:linear-gradient(90deg,#040404,#1a1a1a 45%,#050505)}
  .spine img{position:absolute;left:9px;top:20px;width:34px;height:34px;object-fit:contain}
  .spine .t{position:absolute;left:0;right:0;top:84px;bottom:24px;writing-mode:vertical-rl;color:#fff;font-weight:700;font-size:24px;letter-spacing:7px;line-height:52px;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
</style></head><body>
<div class="scene"><div class="box">
  <div class="spine" id="spine"><img id="lg2" alt=""><div class="t">${esc(title)}</div></div>
  <div class="front" id="front"><div class="head"><img id="lg1" alt=""><span>AMAZON LUNA</span></div>
    <div class="line"></div><img id="art" alt="">${tile ? `<div class="tile" style="background:${tile.color}"><b>${esc(tile.top)}</b><i style="background:${tile.rule}"></i><span${tile.bottom.length > 4 ? ' class="long"' : ''}>${esc(tile.bottom)}</span></div>` : ''}${features && features.length ? `<div class="badges">${badgeImgs(features)}</div>` : ''}<div class="gloss"></div></div>
</div></div>
<script>
// ready once the pictures are in (the cover from the saved file, or Amazon's
// copy if that can't be read): the area the case covers, for the capture
window.__ready = new Promise(function (resolve) {
  var art = document.getElementById('art'), srcs = ${JSON.stringify([coverUrl, altUrl].filter(Boolean))}, si = 0, left = 2;
  function done() {
    if (--left) return;
    requestAnimationFrame(function () { requestAnimationFrame(function () {
      var a = document.getElementById('front').getBoundingClientRect(), b = document.getElementById('spine').getBoundingClientRect();
      var x = Math.floor(Math.min(a.left, b.left)) - 4, y = Math.floor(Math.min(a.top, b.top)) - 4;
      var r = Math.ceil(Math.max(a.right, b.right)) + 4, btm = Math.ceil(Math.max(a.bottom, b.bottom)) + 6;
      resolve({ x: Math.max(0, x), y: Math.max(0, y), width: Math.min(700, r) - Math.max(0, x), height: Math.min(1000, btm) - Math.max(0, y), cover: art.naturalWidth > 0, used: si });
    }); });
  }
  art.onload = function () { (art.decode ? art.decode() : Promise.resolve()).catch(function () {}).then(done); };
  art.onerror = function () { if (++si < srcs.length) art.src = srcs[si]; else done(); };
  art.src = srcs[0] || '';
  var n = 0;
  ['lg1', 'lg2'].forEach(function (id) { var im = document.getElementById(id); im.onload = im.onerror = function () { if (++n === 2) done(); }; im.src = ${JSON.stringify(logoUrl)}; });
});
</script></body></html>`;
}
async function drawBoxes(list) {
  let made = 0, win = null;
  try {
    win = new BrowserWindow({ show: false, width: 700, height: 1000, frame: false, transparent: true, backgroundColor: '#00000000',
      webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false } });
    const wc = win.webContents;
    let lastPaint = null;
    wc.on('paint', (e, dirty, image) => { lastPaint = image; });
    try { wc.setFrameRate(30); } catch (e) { /* ignore */ }
    const page = path.join(app.getPath('userData'), 'luna-box.html');
    const logo = pathToFileURL(path.join(HOME, 'luna-icon.png')).href;
    for (const g of list) {
      try {
        if (!g || !(g.cover || g.url) || !g.out || !/^[0-9A-Z]{10}-box3d\.png$/.test(path.basename(g.out))) continue;
        const alt = /^https:\/\/[a-z0-9.-]*media-amazon\.com\//i.test(String(g.url || '')) ? String(g.url) : '';
        fs.writeFileSync(page, boxHtml(g.cover ? pathToFileURL(g.cover).href : '', logo, String(g.title || ''), alt, { age: g.age, label: g.label }, g.features));
        await wc.loadFile(page);
        const r = await Promise.race([wc.executeJavaScript('window.__ready'), new Promise((res, rej) => setTimeout(() => rej(new Error('timed out')), 8000))]);
        if (!r.cover) throw new Error("the cover picture couldn't be read (the saved file or Amazon's copy); the flat box art stays");
        if (r.used) log(`3D box for ${g.title}: the saved cover couldn't be read, Amazon's copy was used`);
        await new Promise(res => setTimeout(res, 150));
        let img = await wc.capturePage(r).catch(() => null);
        if ((!img || img.isEmpty()) && lastPaint && !lastPaint.isEmpty()) img = lastPaint.crop(r);
        if (!img || img.isEmpty()) throw new Error('nothing was drawn');
        img = img.resize({ width: 500, quality: 'best' });
        const tmp = g.out + '.tmp.png';
        fs.writeFileSync(tmp, img.toPNG());
        fs.renameSync(tmp, g.out);
        made++;
      } catch (e) { log(`3D box for ${g && g.title}: ${e.message}`); }
    }
  } catch (e) { log(`3D game boxes: ${e.message}`); }
  try { if (win) win.destroy(); } catch (e) { /* ignore */ }
  return made;
}
function runGameList(mode, why, tell) {
  if (glRun) { glAgain = [mode, why, tell]; return; }
  const { spawn } = require('child_process');
  log(`Batocera game list: updating to "${mode}" (${why})`);
  let out = '';
  try {
    // its own process group, so it carries on (and finishes the list) if the
    // app is closed before it's done; it then writes to the app's log itself
    glRun = spawn('python3', [SYNC_GAMELIST, mode, '--site', lunaHost()], { env: Object.assign({}, process.env, { LUNA_HOME: HOME, LUNA_APP_LOG: LOG }), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  } catch (e) { glRun = null; log(`Batocera game list: ${e.message}`); if (tell) mainToast('glFail'); return; }
  let seen = 0;
  glRun.stdout.on('data', d => {
    out += d;
    // as it goes: the games listed (pictures still coming), or waiting for an earlier run
    const lines = out.split('\n');
    for (; seen < lines.length - 1; seen++) {
      let m; try { m = JSON.parse(lines[seen]); } catch (e) { continue; }
      const p = glStep(m, !!cfg.game_list_3d && mode !== 'off');
      if (p != null && mode !== 'off') glProgress(p);
      if (m.stage === 'listed') log(`Batocera game list: ${m.count} games listed; their pictures are still coming (this carries on if the app is closed)`);
      else if (m.stage === 'waiting') log('Batocera game list: waiting for the update already running to finish');
    }
  });
  glRun.stderr.on('data', d => { out += d; });
  glRun.on('error', e => { out += `{"error": ${JSON.stringify(e.message)}}\n`; });
  if (mode !== 'off') glProgress(0);
  glRun.on('close', code => {
    glRun = null;
    glProgress(null);
    let last = {}, need = [];
    for (const line of out.trim().split('\n').reverse()) { try { last = JSON.parse(line); break; } catch (e) { /* not JSON */ } }
    // what it warned about goes in the log; 3D boxes it couldn't draw itself, the app draws
    for (const line of out.trim().split('\n')) {
      let m; try { m = JSON.parse(line); } catch (e) { continue; }
      if (m && m.warning) log(`Batocera game list: ${m.warning}`);
      if (m && Array.isArray(m.need_boxes)) need = need.concat(m.need_boxes);
    }
    if (last.done && need.length && mode !== 'off' && cfg.game_list_3d && !boxTried.has(need.map(n => n.id).sort().join())) {
      boxTried.add(need.map(n => n.id).sort().join());
      drawBoxes(need).then(made => {
        log(`Batocera game list: drew ${made} of ${need.length} 3D game boxes`);
        if (made) runGameList(mode, '3D game boxes drawn', false);
      });
    }
    if (last.done) {
      log(`Batocera game list: ${last.mode === 'off' ? "back to just the app's entry" : `${last.count} games`}; it shows once you're back in Batocera`);
      if (tell) mainToast(last.mode === 'off' ? 'glOffDone' : 'glDone', { n: last.count }, 6000);
    } else {
      log(`Batocera game list: couldn't update (${last.error || out.trim().split('\n').pop() || 'exit ' + code})`);
      if (tell) mainToast('glFail', null, 6000);
    }
    if (glAgain) { const a = glAgain; glAgain = null; runGameList(...a); }
  });
}
// Games I pick on: once a game is launching (not on its store page), a hint
// at the bottom, once per game each time the app is open, saying how to add
// it to the list (or take it out)
const pickHinted = new Set();
function pickHint(wc, url) {
  if (cfg.game_list !== 'picked' || SETTINGS_MODE || overlay) return;
  const first = gameFromUrl(url);
  if (!first || pickHinted.has(first.id)) return;
  pickHinted.add(first.id);
  // a moment later, once the page has settled (and has the game's name as its title)
  setTimeout(() => {
    try {
      if (wc.isDestroyed() || overlay) return;
      let pageTitle = String(wc.getTitle() || '').split(/\s+[|\u2013\u2014-]\s+/)[0].trim();
      pageTitle = pageTitle.replace(/^play\s+/i, '');
      if (/^(amazon|luna)\b/i.test(pageTitle) || /^https?:/i.test(pageTitle)) pageTitle = '';
      const g = gameFromUrl(url, pageTitle) || first;
      const key = pickedGames().some(x => x.id === g.id) ? 'gpHintRemove' : 'gpHintAdd';
      wc.send('luna-toast', i18n.t(cfg.language, key, { game: g.title }), 6000);
    } catch (e) { /* ignore */ }
  }, 1500);
}
// "Games I pick" just turned on: a short how-to (OK / Don't show this again).
// From the F1 Settings shortcut (no dashboard), it waits for the next start.
const PICK_TIP_HIDDEN = path.join(HOME, 'pick-tip-hidden');
const PICK_TIP_DUE = path.join(HOME, 'pick-tip-due');
function pickTipDue() {
  if (fs.existsSync(PICK_TIP_HIDDEN)) return;
  if (SETTINGS_MODE) { try { fs.writeFileSync(PICK_TIP_DUE, 'x'); } catch (e) { /* ignore */ } return; }
  queuePrompt({ kind: 'picktip' });
}
function pickTipHtml() {
  const L = cfg.language;
  const T = k => i18n.t(L, k).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<!doctype html>
<html lang="${L}"><head><meta charset="utf-8"><title>Amazon Luna</title>
<style>
  ${i18n.FONT_CSS}${PAGE_CSS}
  .card{max-width:980px;text-align:left}
  h1{text-align:center;margin-bottom:26px}
  ol{margin:0 0 34px;padding:0;list-style:none;counter-reset:s}
  li{counter-increment:s;display:flex;gap:18px;align-items:flex-start;font-size:24px;line-height:1.4;color:#eee;margin:0 0 18px}
  li:before{content:counter(s);flex:none;width:40px;height:40px;border-radius:50%;background:#9146ff;color:#fff;font-weight:700;display:flex;align-items:center;justify-content:center}
  .row{display:flex;gap:20px;justify-content:center}
  .b{border-radius:10px;padding:16px 34px;font-size:22px;font-weight:600;background:#262626;color:#ddd;border:3px solid #555}
  .b.yes{background:#9146ff;color:#fff;border-color:#9146ff}
  .b.on{outline:4px solid #fff;outline-offset:4px}
</style></head><body>
<div class="card">
  <h1>${T('ptT')}</h1>
  <ol><li>${T('ptS1')}</li><li>${T('ptS2')}</li><li>${T('ptS3')}</li><li>${T('ptS4')}</li></ol>
  <div class="row">
    <button class="b yes" data-a="ok">${T('pinOk')}</button>
    <button class="b" data-a="never">${T('never')}</button>
  </div>
</div>
<script>
(function () {
  var P = '${ACTION_PREFIX}';
  var bs = Array.prototype.slice.call(document.querySelectorAll('.b')), cur = 0, sent = false;
  function go(a) { if (sent) return; sent = true; location.href = P + 'picktip?a=' + a; }
  function render() { bs.forEach(function (b, i) { b.classList.toggle('on', i === cur); }); }
  bs.forEach(function (b, i) { b.addEventListener('click', function () { cur = i; go(b.getAttribute('data-a')); }); });
  window.addEventListener('keydown', function (e) {
    var k = e.key;
    if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowUp') cur = (cur + 1) % bs.length;
    else if (k === 'Enter' || k === ' ' || k === 'NumpadEnter') { go(bs[cur].getAttribute('data-a')); return; }
    else if (k === 'y' || k === 'Y') { go('never'); return; }
    else if (k === 'Escape' || k === 'Backspace') { go('ok'); return; }
    else return;
    e.preventDefault(); render();
  });
  render();
})();
</script></body></html>`;
}
// Settings > Controller > "Move around Luna with the app": for the whole
// machine (config.json); the next page Luna opens uses it
function saveDashNav(on) {
  if (on === cfg.dashboard_nav) return;
  cfg.dashboard_nav = on;
  let obj = {};
  try { obj = JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch (e) { obj = {}; }
  obj.dashboard_nav = on;
  try { fs.writeFileSync(CONFIG, JSON.stringify(obj, null, 2) + '\n'); } catch (e) { log(`could not save settings: ${e.message}`); }
  log(`the app's own D-pad navigation on Luna's pages ${on ? 'on' : 'off'}`);
  for (const w of BrowserWindow.getAllWindows ? BrowserWindow.getAllWindows() : []) { try { w.webContents.send('luna-dashnav', on); } catch (e) { /* ignore */ } }
}
// Settings saved: the choice is for the whole machine (config.json)
function saveGameList(q) {
  const mode = String(q.get('glist') || '');
  if (!['off', 'all', 'picked'].includes(mode)) return;
  if (mode === 'picked' && cfg.game_list !== 'picked') pickTipDue();
  let pickChanged = false;
  const id = String(q.get('gid') || '').toUpperCase();
  if (GAME_ID_RE.test(id) && q.has('gpick') && mode === 'picked') {
    const list = pickedGames(), has = list.some(g => g.id === id), want = q.get('gpick') === '1';
    if (want !== has) {
      const next = want ? list.concat([{ id, slug: String(q.get('gslug') || '').slice(0, 120) }]) : list.filter(g => g.id !== id);
      try { fs.writeFileSync(PICKED_FILE, JSON.stringify(next, null, 2) + '\n'); pickChanged = true; } catch (e) { log(`could not save the picked games: ${e.message}`); }
      log(`Batocera game list: ${want ? 'added' : 'removed'} ${id}`);
    }
  }
  const box3d = q.get('g3d') === '1', boxChanged = q.has('g3d') && box3d !== !!cfg.game_list_3d;
  if (mode !== cfg.game_list || boxChanged) {
    cfg.game_list = mode;
    if (boxChanged) { cfg.game_list_3d = box3d; log(`Batocera game list: 3D game boxes ${box3d ? 'on' : 'off'}`); }
    let obj = {};
    try { obj = JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch (e) { obj = {}; }
    obj.game_list = mode;
    obj.game_list_3d = !!cfg.game_list_3d;
    try { fs.writeFileSync(CONFIG, JSON.stringify(obj, null, 2) + '\n'); } catch (e) { log(`could not save settings: ${e.message}`); }
    if (mode === 'off' && !(mode !== glState().mode)) return;   // boxes changed with no games listed: nothing to redo
  } else if (!(mode === 'picked' && pickChanged)) return;
  mainToast('glBusy', null, 4000);
  runGameList(mode, 'Settings', true);
}

// ---------- Save logs for help ----------
// One zip in Batocera's share folder with what's needed to sort out a
// problem: the logs, the settings, the controller setup and a short summary.
// Profile names are replaced, nothing about the sign-in
// itself is included.
const SHARE = process.env.LUNA_SHARE || '/userdata';
let CRC_TABLE = null;
function crc32(buf) {
  if (zlib.crc32) return zlib.crc32(buf);
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC_TABLE[n] = c; }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function makeZip(files) {   // [{name, data: Buffer}] -> Buffer
  const parts = [], central = [];
  let off = 0;
  const d = new Date(), dt = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff,
    dd = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8'), raw = f.data, comp = zlib.deflateRawSync(raw), crc = crc32(raw);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8);
    h.writeUInt16LE(dt, 10); h.writeUInt16LE(dd, 12); h.writeUInt32LE(crc, 14); h.writeUInt32LE(comp.length, 18);
    h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(name.length, 26); h.writeUInt16LE(0, 28);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt16LE(dt, 12); c.writeUInt16LE(dd, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20);
    c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(off, 42);
    parts.push(h, name, comp); central.push(c, name);
    off += h.length + name.length + comp.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat(parts.concat([cd, end]));
}
// Batocera's version, from its own file ("42 2025/08/20 12:00"): "Batocera 42 (2025/08/20)"
// HippOS (a Debian-based gaming system built like Batocera) runs this too
function batoceraVersion() {
  if (ON_HIPPOS) {
    let v = '';
    try { v = fs.readFileSync(HIPPOS_VERSION_FILE, 'utf8').trim().split('\n')[0]; } catch (e) { v = ''; }
    return v ? `HippOS ${v}` : 'HippOS version unknown';
  }
  let t = '';
  try { t = fs.readFileSync(process.env.LUNA_BATOCERA_VERSION || '/usr/share/batocera/batocera.version', 'utf8').trim().split('\n')[0]; } catch (e) { return 'Batocera version unknown'; }
  const m = /^(\S+)(?:\s+(\S+))?/.exec(t);
  return m ? `Batocera ${m[1]}${m[2] ? ` (${m[2]})` : ''}` : 'Batocera version unknown';
}
function readText(f, max) {
  try {
    const st = fs.statSync(f);
    const n = Math.min(st.size, max || 512 * 1024), fd = fs.openSync(f, 'r'), b = Buffer.alloc(n);
    fs.readSync(fd, b, 0, n, st.size - n); fs.closeSync(fd);
    return b.toString('utf8');
  } catch (e) { return null; }
}
function saveSupportLogs(wc) {
  const done = f => { if (wc && !wc.isDestroyed()) wc.executeJavaScript(`window.__logsStatus && window.__logsStatus(${JSON.stringify(f)})`).catch(() => {}); };
  try {
    // gamertags: the profiles' names and any name the logs mention
    const names = new Map();
    profiles.list.forEach((p, i) => { if (p.name) names.set(p.name, `Profile ${i + 1}`); });
    const logs = { 'luna-app.log': readText(LOG), 'luna.log': readText(path.join(path.dirname(LOG), 'luna.log')),
      'luna-install.log': readText(path.join(path.dirname(LOG), 'luna-install.log')),
      'luna-update.log': readText(path.join(path.dirname(LOG), 'luna-update.log')) };
    const NAME_RES = [/signed in: (.+?) \(/g, /gamerpic saved for (.+?) \(/g, /profile: (.+?) \(/g, /first profile: (.+)$/gm,
      /profiles: (?:added|removed) (.+)$/gm, /^\S+ (.+?) has a profile already/gm, /settings saved for (.+?):/g];
    let other = 0;
    for (const t of Object.values(logs)) {
      if (!t) continue;
      for (const re of NAME_RES) for (const m of t.matchAll(re)) {
        const n = m[1].trim();
        if (n && n !== '?' && n !== 'none' && !/^p\d+$/.test(n) && !names.has(n)) names.set(n, `Player ${++other}`);
      }
    }
    const order = [...names.keys()].sort((a, b) => b.length - a.length);
    const scrub = t => {
      for (const n of order) t = t.split(n).join(names.get(n));
      return t.replace(/\b2\d{15}\b/g, '[xuid]').replace(/(XBL3\.0 x=|Authorization:?\s*)\S+/gi, '$1[removed]');
    };
    const files = [];
    const add = (name, text) => { if (text != null) files.push({ name, data: Buffer.from(text, 'utf8') }); };
    for (const [n, t] of Object.entries(logs)) add(n, t == null ? null : scrub(t));
    add('config.json', readText(CONFIG));
    if (profiles.active) {
      add('profiles.json', JSON.stringify({ pin: profiles.hasPin,
        profiles: profiles.list.map((p, i) => ({ id: p.id, name: `Profile ${i + 1}`, age: p.age, signedIn: !!p.xuid })) }, null, 2) + '\n');
      for (const p of profiles.list) add(`profile-settings/${p.id}.json`, readText(path.join(HOME, 'profile-settings', p.id + '.json')));
    }
    const bv = readText('/usr/share/batocera/batocera.version');
    const pads = [];
    try {
      for (const d of fs.readdirSync(POWER_DIR)) {
        const r = n => (readText(path.join(POWER_DIR, d, n)) || '').trim();
        if (r('scope') === 'Device') pads.push(`${d}: ${r('capacity') ? r('capacity') + '%' : r('capacity_level') || '?'} ${r('status')}`);
      }
    } catch (e) { /* none */ }
    add('about.txt', [
      `Amazon Luna ${VERSION}`, `Saved ${new Date().toString()}`,
      `Browser engine: Electron ${process.versions.electron} (Chromium ${process.versions.chrome}), ${process.arch}`,
      `Batocera: ${bv ? bv.trim() : 'unknown'}`, `Language: ${cfg.language}`,
      `Profiles: ${profiles.count}`,
      `Controller batteries: ${pads.join('; ') || 'none reported'}`, ''].join('\n'));
    const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
    const name = `luna-logs-${stamp}.zip`;
    fs.writeFileSync(path.join(SHARE, name), makeZip(files));
    log(`logs saved for help: ${path.join(SHARE, name)} (${files.length} files)`);
    done(name);
  } catch (e) {
    log(`could not save the logs: ${e.message}`);
    done('');
  }
}

// ---------- controller batteries ----------
// Linux lists a wireless controller's battery in /sys/class/power_supply
// (scope "Device"). A message shows on screen when it gets low (15%, again
// at 5%), so the controller doesn't just die in the middle of a game.
const POWER_DIR = process.env.LUNA_POWER_SUPPLY || '/sys/class/power_supply';
const batteryWarned = {};
function checkPadBatteries() {
  let dirs = [];
  try { dirs = fs.readdirSync(POWER_DIR); } catch (e) { return; }
  for (const d of dirs) {
    const r = n => { try { return fs.readFileSync(path.join(POWER_DIR, d, n), 'utf8').trim(); } catch (e) { return ''; } };
    if (r('scope') !== 'Device') continue;
    if (/^(Charging|Full)$/i.test(r('status'))) { delete batteryWarned[d]; continue; }
    const cap = parseInt(r('capacity'), 10), lvl = r('capacity_level');
    const level = Number.isFinite(cap) ? (cap <= 5 ? 2 : cap <= 15 ? 1 : 0) : /critical/i.test(lvl) ? 2 : /low/i.test(lvl) ? 1 : 0;
    if (!level) { delete batteryWarned[d]; continue; }
    if ((batteryWarned[d] || 0) >= level) continue;
    batteryWarned[d] = level;
    log(`controller battery low: ${d} ${Number.isFinite(cap) ? cap + '%' : lvl}`);
    const wc = mainWin && mainWin.webContents;
    const msg = Number.isFinite(cap) ? i18n.t(cfg.language, 'padLow', { n: cap }) : i18n.t(cfg.language, 'padLowX');
    try { if (wc) wc.send('luna-toast', msg, 6000); } catch (e) { /* ignore */ }
  }
}

// ---------- Updates: the app (GitHub Releases) and the browser engine ----------
// One press of Settings > Updates checks both and gets whatever is newer, by
// itself:
//  - the app: the newest Release of the app's GitHub repository (only
//    published Releases, never work in progress). Its zip is downloaded,
//    unpacked and checked into update-staged/; the next time the app
//    closes, Launch-AmazonLuna.sh runs that version's installer in the
//    background (luna-apply-update.sh), which keeps config.json, the
//    profiles, sign-ins, PIN and picked games, and also brings the newest
//    engine. So the new version is the one used the next time it opens.
//  - the engine (Electron), when only it is newer: Build-Runtime.py --stage
//    downloads it next to the one in use (checked against Electron's
//    published checksums); Run-App.sh switches to it the next time.
// Anything that fails leaves the app as it was; every step is in the log.
const UPDATE_REPO = process.env.LUNA_REPO || 'rmach89/luna-batocera-hippos';
const RELEASES_URL = process.env.LUNA_RELEASES_URL || `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`;
const UPDATE_STAGED = path.join(HOME, 'update-staged');
let upd = { state: 'idle' };
function updStatus(st) {
  upd = st;
  const wc = settingsWc;
  if (!wc || wc.isDestroyed()) return;
  wc.executeJavaScript(`window.__updateStatus && window.__updateStatus(${JSON.stringify(st)})`).catch(() => { /* Settings closed */ });
}
function verNum(v) { return String(v || '').replace(/^v/, '').split(/[.-]/).slice(0, 3).map(n => parseInt(n, 10) || 0); }
function newer(a, b) {
  const x = verNum(a), y = verNum(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}
function runBuild(args, onLine, done) {
  const { spawn } = require('child_process');
  let child;
  try {
    child = spawn('python3', [BUILD_RUNTIME].concat(args), { env: Object.assign({}, process.env, { LUNA_HOME: HOME }), stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) { done(1, e.message); return; }
  let buf = '', all = '';
  const take = d => {
    buf += d.toString(); all += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); try { onLine(line); } catch (e) { /* ignore */ } }
  };
  child.stdout.on('data', take);
  child.stderr.on('data', take);
  child.on('error', e => done(1, e.message));
  child.on('close', code => { if (buf) onLine(buf); done(code, all); });
}
function stagedAppVersion() {
  try { return fs.readFileSync(path.join(UPDATE_STAGED, 'ready'), 'utf8').trim(); } catch (e) { return ''; }
}
// the newest Release: { version, zip } (null with a reason when it can't be read)
function latestRelease() {
  return new Promise(resolve => {
    let req;
    try { req = net.request({ url: RELEASES_URL, method: 'GET' }); } catch (e) { resolve({ error: e.message }); return; }
    req.setHeader('Accept', 'application/vnd.github+json');
    req.setHeader('User-Agent', 'luna-batocera-hippos/' + VERSION);
    const timer = setTimeout(() => { try { req.abort(); } catch (e) { /* ignore */ } resolve({ error: 'timed out' }); }, 20000);
    req.on('response', res => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => {
        clearTimeout(timer);
        if (res.statusCode !== 200) { resolve({ error: res.statusCode === 404 ? 'no release published yet (HTTP 404)' : `HTTP ${res.statusCode}` }); return; }
        try {
          const r = JSON.parse(body);
          const version = String(r.tag_name || '').replace(/^[vV]/, '');
          const asset = (r.assets || []).find(a => /\.zip$/i.test(String(a.name || '')));
          if (!version || !asset) { resolve({ error: 'the newest release has no version tag or no zip' }); return; }
          resolve({ version, zip: asset.browser_download_url });
        } catch (e) { resolve({ error: 'GitHub\'s answer couldn\'t be read' }); }
      });
    });
    req.on('error', e => { clearTimeout(timer); resolve({ error: e.message }); });
    req.end();
  });
}
// download a file, with progress (0-100)
function download(url, dest, onPct) {
  return new Promise((resolve, reject) => {
    let req, out, got = 0, total = 0, last = -1;
    try { req = net.request({ url, method: 'GET', redirect: 'follow' }); } catch (e) { reject(e); return; }
    req.setHeader('User-Agent', 'luna-batocera-hippos/' + VERSION);
    req.on('response', res => {
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      total = Number(res.headers['content-length']) || 0;
      try { out = fs.createWriteStream(dest); } catch (e) { reject(e); return; }
      res.on('data', d => {
        out.write(d); got += d.length;
        const pct = total ? Math.floor(got * 100 / total) : 0;
        if (pct !== last) { last = pct; onPct(pct); }
      });
      res.on('end', () => out.end(() => (total && got < total ? reject(new Error(`cut off at ${Math.floor(got * 100 / total)}%`)) : resolve(got))));
      res.on('error', e => { try { out.end(); } catch (x) { /* ignore */ } reject(e); });
    });
    req.on('error', reject);
    req.end();
  });
}
function unzip(zip, dir) {
  const { execFileSync } = require('child_process');
  execFileSync('python3', ['-I', '-c', 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', zip, dir], { timeout: 120000 });
}
// download, unpack and check the newest app; ready for the next close
async function stageApp(rel, onPct) {
  const work = UPDATE_STAGED + '.new';
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  const zip = path.join(work, 'update.zip');
  try {
    await download(rel.zip, zip, onPct);
  } catch (e) { fs.rmSync(work, { recursive: true, force: true }); throw new Error(`app download failed (${e.message})`); }
  try { unzip(zip, path.join(work, 'pkg')); } catch (e) { fs.rmSync(work, { recursive: true, force: true }); throw new Error('the zip couldn\'t be unpacked'); }
  fs.rmSync(zip, { force: true });
  // the package: install.sh next to system/add-ons/luna with the app in it, of the version the release says
  const find = (dir, depth) => {
    if (fs.existsSync(path.join(dir, 'install.sh'))) return dir;
    if (depth <= 0) return '';
    for (const n of fs.readdirSync(dir)) { const d = path.join(dir, n); if (fs.statSync(d).isDirectory()) { const f = find(d, depth - 1); if (f) return f; } }
    return '';
  };
  const root = find(path.join(work, 'pkg'), 2);
  let pv = '';
  try { pv = JSON.parse(fs.readFileSync(path.join(root, 'system/add-ons/luna/app-source/package.json'), 'utf8')).version; } catch (e) { pv = ''; }
  if (!root || !fs.existsSync(path.join(root, 'system/add-ons/luna/app.asar')) || pv !== rel.version) {
    fs.rmSync(work, { recursive: true, force: true });
    throw new Error(`the zip didn't look right (${!root ? 'no install.sh' : pv !== rel.version ? `it holds v${pv || '?'}, not v${rel.version}` : 'no app.asar'})`);
  }
  fs.writeFileSync(path.join(work, 'ready'), rel.version + '\n');
  fs.rmSync(UPDATE_STAGED, { recursive: true, force: true });
  fs.renameSync(work, UPDATE_STAGED);
}
function stageEngine(onPct) {
  return new Promise((resolve, reject) => {
    let staged = false;
    runBuild(['--stage'], line => {
      const m = line.match(/^\s*(\d+)%/);
      if (m) onPct(Number(m[1]));
      if (/^STAGED /.test(line)) staged = true;
    }, (code, out) => (code === 0 && staged ? resolve() : reject(new Error(`engine download failed (${String(out).trim().split('\n').pop() || code})`))));
  });
}
function engineCheck() {
  return new Promise(resolve => {
    let info = null;
    runBuild(['--check'], line => { if (/^\s*\{/.test(line)) { try { info = JSON.parse(line); } catch (e) { /* ignore */ } } },
      (code, out) => resolve(code === 0 && info && info.latest ? info : { error: String(out).trim().split('\n').pop() || `exit ${code}` }));
  });
}
async function checkForUpdates() {
  if (upd.state === 'checking' || upd.state === 'getting') return;
  const engine = 'v' + process.versions.electron;
  updStatus({ state: 'checking' });
  log(`updates: checking (app v${VERSION} on GitHub ${UPDATE_REPO}, engine ${engine} on Electron)`);
  const [rel, eng] = await Promise.all([latestRelease(), engineCheck()]);
  if (rel.error) log(`updates: couldn't reach GitHub (${rel.error})`);
  if (eng.error) log(`updates: couldn't check the engine (${eng.error})`);
  if (rel.error && eng.error) { log('updates: nothing changed'); updStatus({ state: 'fail' }); return; }
  const staged = stagedAppVersion();
  const appNew = !rel.error && newer(rel.version, VERSION) && !(staged && !newer(rel.version, staged)) ? rel : null;
  const engStaged = !eng.error && eng.staged && !newer(eng.latest, eng.staged) && newer(eng.staged, engine);
  const engNew = !eng.error && newer(eng.latest, engine) && !engStaged;
  if (!rel.error) log(`updates: app: this is v${VERSION}, newest v${rel.version}${staged ? `, v${staged} already downloaded` : ''}`);
  if (!eng.error) log(`updates: engine: this is ${engine}, newest ${eng.latest}${eng.staged ? `, ${eng.staged} already downloaded` : ''}`);
  if (!appNew && !engNew) {
    if ((staged && newer(staged, VERSION)) || engStaged) { log('updates: already downloaded; used the next time the app opens'); updStatus({ state: 'done', a: staged || VERSION, e: String(engStaged ? eng.staged : engine).replace(/^v/, '') }); return; }
    log('updates: up to date');
    updStatus({ state: rel.error || eng.error ? 'fail' : 'none' });
    return;
  }
  updStatus({ state: 'getting', p: 0 });
  try {
    if (appNew) {
      // the new app's installer brings the newest engine too
      log(`updates: app v${rel.version} found, downloading...`);
      await stageApp(rel, p => updStatus({ state: 'getting', p }));
      log(`updates: app v${rel.version} downloaded; it's installed when the app closes and used the next time it opens (settings, profiles and sign-ins are kept)`);
    } else {
      log(`updates: engine ${eng.latest} found, downloading...`);
      await stageEngine(p => updStatus({ state: 'getting', p }));
      log(`updates: engine ${eng.latest} downloaded; used the next time the app opens`);
    }
    updStatus({ state: 'done', a: appNew ? rel.version : VERSION, e: String(appNew ? process.versions.electron : eng.latest).replace(/^v/, '') });
  } catch (e) {
    log(`updates: ${e.message}: nothing changed`);
    updStatus({ state: 'fail' });
  }
}

// ---------- who is signed in (profiles) ----------
// On Xbox the app read who signed in (gamertag and age group) from Xbox's
// own sign-in answers, to set up profiles by itself. Amazon's sign-in says
// nothing the app can read, so on Luna profiles are added from Settings >
// Profiles; the code below stays for profiles carried over in a backup.
let identitySeen = '';
let ageGroupSeen = '';
function seen(person, how) {
  // Xbox's answer for its own services also carries a sign-in token: used
  // (in memory only) to ask Xbox's profile service for the gamerpic
  if (person.xuid && person.token && person.uhs) gamerpicAuth = { xuid: person.xuid, uhs: person.uhs, token: person.token };
  const key = [person.xuid, person.name, person.age].join('|');
  if (!person.age && !person.xuid && !person.name) return;
  if (key === identitySeen) return;
  identitySeen = key;
  if (person.age && person.age !== ageGroupSeen) { ageGroupSeen = person.age; log(`account age group: ${person.age} (${how})`); }
  if (person.name || person.xuid) log(`signed in: ${person.name || '?'} (${how})`);

  if (!profiles.active) {
    if (person.xuid || person.name) {
      // the first person seen becomes the first profile (nothing changes for them)
      curProfile = profiles.start(person);
      log(`first profile: ${curProfile.name}`);
    } else return;   // only the age group is known so far
  } else if (curProfile) {
    const fresh = {};
    if (person.age) fresh.age = person.age;
    if (person.name) fresh.name = person.name;
    if (!curProfile.xuid || !person.xuid || person.xuid === curProfile.xuid) {
      // this profile's own person (or a new profile's first sign-in)
      if (person.xuid) fresh.xuid = person.xuid;
      profiles.update(curProfile, fresh);
    } else {
      otherPerson(person);
      return;
    }
  }
  afterIdentity();
}
// the age group may have changed what this profile is allowed, and an
// adult may need to be asked for a PIN
let pinAsked = false;
function afterIdentity() {
  fetchGamerpic();
  // a child or teen plays here now: whoever just signed in may be leaving
  // an adult's profile open
  if (isMinor(curProfile)) unlockedId = '';
  // asked as soon as a child's or teen's profile is set up (also on that
  // profile's first sign-in), while the adult setting it up is usually
  // still there, rather than later when a child could get to it first
  if (profiles.active && !pinAsked && curProfile && curProfile.age && minorsHere() && !profiles.hasPin) {
    pinAsked = true;
    log("a child's or teen's profile is set up and adult profiles have no PIN: asking for one now");
    queuePrompt({ kind: 'pinsetup' });
  }
}
// someone other than this profile's person signed in on it
function otherPerson(person) {
  const known = profiles.byXuid(person.xuid);
  if (known) {
    // an adult's account signed in on a child's profile: the PIN first
    if (isMinor(curProfile) && needsPin(known)) {
      log(`${person.name || person.xuid} (an adult's profile) signed in on ${profileName(curProfile)}'s restricted profile: asking for the PIN`);
      queuePrompt({ kind: 'movepin', pend: { kind: 'move', id: known.id, person } });
      return;
    }
    moveSignIn(known, person);
    return;
  }
  if (profiles.declined) { log('a different person signed in; profiles: "don\'t ask again" was chosen'); return; }
  queuePrompt({ kind: 'setup', person });
}
// a person with their own profile signed in here: this storage is now
// theirs; this profile starts fresh (signs in again next time)
function moveSignIn(known, person) {
  {
    log(`${person.name || person.xuid} has a profile already: moving this sign-in to it`);
    const mine = curProfile;
    const theirsOld = sessionFor(known);
    profiles.update(known, { part: mine.part, age: person.age || known.age, name: person.name || known.name });
    profiles.update(mine, { part: `luna-${mine.id}-${Date.now().toString(36)}`, xuid: '', age: '' });
    theirsOld.clearStorageData().catch(() => {});
    curProfile = known;
    profiles.setLast(known.id);
    Object.assign(cfg, loadConfig(known.id));
    afterIdentity();
  }
}
// The PIN wasn't given for an adult's sign-in on a child's profile: that
// sign-in is undone (this profile's storage is signed out), so the child
// signs in with their own account again.
function undoAdultSignIn(person) {
  log(`PIN not given: ${person && (person.name || person.xuid) || 'that'} sign-in on ${profileName(curProfile)}'s profile is signed out again`);
  identitySeen = '';
  curSession().clearStorageData().catch(() => {}).then(() => { if (mainWin) { siteReady = false; openStart(mainWin.webContents); } });
}
// answer to "Set up profiles?"
function setupAnswer(answer, person, pinOk) {
  if (answer === 'never') { profiles.declined = true; log('profiles: "Don\'t ask again"'); return; }
  if (answer !== 'yes' || !person) { log('profiles: "Not now"'); return; }
  // a new adult's profile made from a child's: the PIN first
  if (!pinOk && isMinor(curProfile) && profiles.hasPin && !isMinor(person)) {
    log(`a new adult's profile from ${profileName(curProfile)}'s restricted profile: asking for the PIN`);
    queuePrompt({ kind: 'movepin', pend: { kind: 'addperson', person } });
    return;
  }
  // the new person's sign-in is in this storage now; the profile that was
  // here starts fresh and signs in again the next time it's picked
  const mine = curProfile;
  const p = profiles.add(person);
  profiles.update(p, { part: mine.part });
  profiles.update(mine, { part: `luna-${mine.id}-${Date.now().toString(36)}`, xuid: '', age: '' });
  curProfile = p;
  profiles.setLast(p.id);
  Object.assign(cfg, loadConfig(p.id));
  log(`profiles: added ${p.name || p.id}`);
  afterIdentity();
}
// Signed in to Amazon? Amazon keeps its sign-in in the "at-main" / "x-main"
// cookies (at-acbuk, x-acbde... in other countries): their presence is all
// the app looks at, never their values. It marks the profile as signed in
// ("Who's playing?" shows "Not signed in" otherwise); with no profiles yet,
// nothing changes.
let signedInLogged = null;
function checkSignedIn(wc) {
  if (!wc || wc.isDestroyed() || !mainWin || wc !== mainWin.webContents) return;
  const ses = wc.session;
  ses.cookies.get({}).then(list => {
    const ok = list.some(c => /(^|\.)amazon\./i.test(c.domain || '') && /^(at|x|sess-at)-(main|acb[a-z]{2})$/i.test(c.name || ''));
    if (ok !== signedInLogged) { signedInLogged = ok; log(ok ? 'signed in to Amazon' : 'not signed in to Amazon yet'); }
    if (curProfile && !!curProfile.xuid !== ok) profiles.update(curProfile, { xuid: ok ? 'amazon' : '' });
  }).catch(() => { /* closed */ });
}
function cleanUserAgent() {
  if (cfg.user_agent) return cfg.user_agent;
  // a plain Chrome user agent, without Electron or app names: Linux, or
  // Windows when "Stream as a Windows PC" is on
  const os = cfg.stream_as_windows ? 'Windows NT 10.0; Win64; x64' : 'X11; Linux x86_64';
  return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
}
function applyUserAgent() {
  const ua = cleanUserAgent();
  app.userAgentFallback = ua;
  try { curSession().setUserAgent(ua); } catch (e) { /* ignore */ }
  try { mainWin && mainWin.webContents.setUserAgent(ua); } catch (e) { /* ignore */ }
}

function blocked(wc, url, how) {
  log(`blocked (${how}): ${url}`);
  try { wc.send('luna-toast', i18n.t(cfg.language, 'blocked'), 2500); } catch (e) { /* ignore */ }
}

// Electron changed some event signatures over time; accept both styles.
function navUrl(event, arg) { return typeof arg === 'string' ? arg : (event && event.url) || ''; }

// Keyboard exit: hold Esc. Watched here (before the page sees the key), so it
// works even during a game; a quick tap of Esc still reaches the page.
let escTimer = null;
let escWarn = null;
function escReset() {
  clearTimeout(escTimer); clearTimeout(escWarn);
  escTimer = null; escWarn = null;
}
function watchEsc(wc) {
  wc.on('before-input-event', (event, input) => {
    if (input.key !== 'Escape') return;
    if (input.type === 'keyDown' && !input.isAutoRepeat && !escTimer) {
      const holdMs = Math.round(cfg.exit_hold_seconds * 1000);
      escWarn = setTimeout(() => { try { wc.send('luna-toast', i18n.t(cfg.language, 'holdEsc'), holdMs); } catch (e) { /* ignore */ } }, 400);
      escTimer = setTimeout(() => fastExit('keyboard, Esc held'), holdMs);
    } else if (input.type === 'keyUp') {
      escReset();
    }
  });
  wc.on('blur', escReset);
}

function guard(wc, isLayer) {
  watchEsc(wc);
  wc.on('dom-ready', () => {
    let u = '';
    try { u = wc.getURL(); } catch (e) { return; }
    if (!/^https:/i.test(u) || dashHost(u)) return;
    wc.executeJavaScript(NO_PAD).catch(() => { /* page between loads */ });
  });
  wc.on('will-navigate', (event, arg) => {
    const url = navUrl(event, arg);
    if (url.startsWith(ACTION_PREFIX)) { event.preventDefault(); handleAction(wc, url); return; }
    if (!isAllowed(url)) { event.preventDefault(); blocked(wc, url, 'link'); }
  });

  wc.on('will-redirect', (event, arg, isInPlace, isMainFrame) => {
    const url = navUrl(event, arg);
    const main = event && typeof event.isMainFrame === 'boolean' ? event.isMainFrame : isMainFrame !== false;
    if (main && !isAllowed(url)) { event.preventDefault(); blocked(wc, url, 'redirect'); }
  });

  // single-page-app route changes that leave the allowed area
  wc.on('did-navigate-in-page', (event, url, isMainFrame) => {
    if (isMainFrame !== false && !isAllowed(url)) {
      blocked(wc, url, 'in-page');
      wc.loadURL(cfg.start_url);
    }
  });

  wc.setWindowOpenHandler(({ url }) => {
    if (isAllowed(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          fullscreen: true,
          autoHideMenuBar: true,
          backgroundColor: '#000000',
          webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
          }
        }
      };
    }
    blocked(wc, url, 'new window');
    return { action: 'deny' };
  });

  wc.on('did-create-window', child => {
    child.setMenuBarVisibility(false);
    guard(child.webContents);
  });

  wc.on('did-fail-load', (event, code, desc, url, isMainFrame) => {
    // -3 is "aborted", which happens on every blocked navigation
    if (isMainFrame && code !== -3) {
      log(`load failed (${code} ${desc}): ${url}`);
      if (isLayer) { closeOverlay(); return; }
      showAppPage(wc, 'luna-error.html', errorHtml());
      markSiteReady();
    }
  });

  wc.on('render-process-gone', (event, details) => {
    if (isLayer) { log('app screen crashed; closing it'); closeOverlay(); return; }
    log(`page crashed (${details && details.reason}); reloading`);
    openStart(wc);
  });

  // make sure keyboard input goes to the page after each load
  wc.on('did-finish-load', () => {
    if (isLayer) { try { wc.focus(); } catch (e) { /* ignore */ } return; }
    // keyboard input goes to the layer on top while it's up
    try { (overlay ? overlay.webContents : wc).focus(); } catch (e) { /* ignore */ }
    if (overlay) setPadsBlocked(true); // a new page: keep it from seeing the controller
    let host = '';
    try { host = new URL(wc.getURL()).hostname; } catch (e) { /* ignore */ }
    if (isLunaHost(host)) {
      markSiteReady();
      setTimeout(() => checkSignedIn(wc), 4000);
    } else if (/(^|\.)amazon\./i.test(host)) setTimeout(() => checkSignedIn(wc), 2000);
    if (loadStarted && isLunaHost(host)) {
      log(`Luna page loaded in ${((Date.now() - loadStarted) / 1000).toFixed(1)} s${GPU_AT_START ? ' (GPU acceleration on)' : ''}`);
      loadStarted = 0;
    }
  });
}

// ---------- controller battery (Settings > Controller) ----------
// What Linux reports for wireless Xbox and PlayStation controllers
// (/sys/class/power_supply, "Device" scope), and a Steam Deck's own battery.
const POWER = process.env.LUNA_POWER_DIR || '/sys/class/power_supply';
function sysText(f) { try { return fs.readFileSync(f, 'utf8').trim(); } catch (e) { return ''; } }
function batteries() {
  const out = [];
  let names = [];
  try { names = fs.readdirSync(POWER); } catch (e) { return out; }
  for (const n of names) {
    const d = path.join(POWER, n), model = sysText(path.join(d, 'model_name')), pct = parseInt(sysText(path.join(d, 'capacity')), 10);
    if (!Number.isFinite(pct)) continue;
    const charging = /^charging$/i.test(sysText(path.join(d, 'status')));
    const label = `${n} ${model}`;
    if (sysText(path.join(d, 'scope')) === 'Device' || /xpadneo|ps-controller|sony_controller|dualsense|dualshock|xbox/i.test(n)) {
      if (/xbox|xpadneo|microsoft/i.test(label)) out.push({ name: 'Xbox', pct, charging });
      else if (/dualsense|ps-controller|sony|dualshock|playstation/i.test(label)) out.push({ name: /dualsense/i.test(label) ? 'DualSense' : 'PlayStation', pct, charging });
    } else if (/^BAT/i.test(n) && /jupiter|galileo/i.test(sysText(process.env.LUNA_DMI_PRODUCT || '/sys/class/dmi/id/product_name'))) {
      out.push({ name: 'Steam Deck', pct, charging });
    }
  }
  // controllers first (Xbox, then PlayStation), the Steam Deck last
  const rank = b => (b.name === 'Xbox' ? 0 : b.name === 'Steam Deck' ? 2 : 1);
  return out.sort((x, y) => rank(x) - rank(y));
}

// ---------- connection check (Settings > Stream) ----------
// Download speed (Cloudflare's public speed test, up to 25 MB / 8 seconds) and
// the ping to Amazon Luna's sign-in server, then the resolution they suit.
function timedGet(url, limitMs) {
  return new Promise(resolve => {
    const t0 = Date.now(); let bytes = 0, done = false;
    const finish = ok => { if (!done) { done = true; resolve({ ok, ms: Date.now() - t0, bytes }); } };
    try {
      const req = net.request({ url, method: 'GET' });
      req.on('response', res => { res.on('data', c => { bytes += c.length; }); res.on('end', () => finish(true)); res.on('error', () => finish(false)); });
      req.on('error', () => finish(false));
      req.end();
      setTimeout(() => { try { req.abort(); } catch (e) { /* ignore */ } finish(bytes > 0); }, limitMs);
    } catch (e) { finish(false); }
  });
}
async function runNetTest(wc) {
  const send = r => { try { if (wc && !wc.isDestroyed()) wc.executeJavaScript(`window.__netResult && window.__netResult(${JSON.stringify(r)})`).catch(() => {}); } catch (e) { /* closed */ } };
  try {
    const pings = [];
    for (let i = 0; i < 5; i++) { const r = await timedGet(process.env.LUNA_PING_URL || `https://${lunaHost()}/robots.txt`, 4000); if (r.ok) pings.push(r.ms); }
    const d = await timedGet(process.env.LUNA_SPEED_URL || 'https://speed.cloudflare.com/__down?bytes=25000000', 8000);
    if (!pings.length || !d.bytes) throw new Error('no answer');
    pings.sort((a, b) => a - b);
    const ping = pings[Math.floor((pings.length - 1) / 2)], mbps = Math.round(d.bytes * 8 / (d.ms / 1000) / 1e5) / 10;
    const rec = mbps >= 45 && ping < 80 ? '1440p' : mbps >= 35 ? '1080p-hq' : mbps >= 25 ? '1080p' : 'auto';
    log(`connection check: ${mbps} Mb/s, ping ${ping} ms: ${rec} recommended`);
    send({ mbps, ping, rec });
  } catch (e) { log(`connection check failed: ${e.message}`); send({ fail: true }); }
}

// ---------- played from the dashboard: counted in EmulationStation's list ----------
// EmulationStation counts the games it starts; a game started inside the app
// is added here (play count, last played, play time) and written to its list
// a few seconds after the app closes (Sync-GameList.py played).
const PLAYED = path.join(HOME, 'played.json');
const played = {};
let playingNow = null;
function esTime(d) { const z = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}T${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`; }
ipcMain.on('luna-stream', (event, m) => {
  const on = !!(m && m.on);
  if (on && !playingNow) {
    const g = streamingGame();
    if (!g || g === GAME_ID) return;   // EmulationStation counts the game it started itself
    playingNow = { g, t: Date.now() };
    const p = played[g] = played[g] || { n: 0, secs: 0, last: '' };
    p.n++; p.last = esTime(new Date());
    log(`playing ${g} from the dashboard`);
  } else if (!on && playingNow) {
    played[playingNow.g].secs += Math.round((Date.now() - playingNow.t) / 1000);
    playingNow = null;
  }
});
function flushPlayed() {
  if (playingNow) { played[playingNow.g].secs += Math.round((Date.now() - playingNow.t) / 1000); playingNow = null; }
  if (!Object.keys(played).length || cfg.game_list === 'off') return;
  try {
    fs.writeFileSync(PLAYED, JSON.stringify(played));
    const { spawn } = require('child_process');
    spawn('python3', [SYNC_GAMELIST, 'played', PLAYED], { env: Object.assign({}, process.env, { LUNA_HOME: HOME, LUNA_APP_LOG: LOG }), stdio: 'ignore', detached: true }).unref();
    log(`games played from the dashboard, for EmulationStation's list: ${Object.keys(played).join(', ')}`);
  } catch (e) { log(`couldn't note the games played: ${e.message}`); }
}

// ---------- instant replay (quick settings) ----------
// The page keeps recording the game in 30-second parts (preload.js); saving
// sends the last two, which ffmpeg joins and trims to the last 30 seconds,
// in /userdata/recordings.
const CLIPS_DIR = process.env.LUNA_CLIPS_DIR || '/userdata/recordings';
ipcMain.on('luna-clip', (event, m) => {
  const wc = event.sender;
  const fail = why => { log(`clip not saved: ${why}`); try { wc.send('luna-toast', i18n.t(cfg.language, 'replayFail'), 3000); } catch (e) { /* ignore */ } };
  try {
    const parts = (m && Array.isArray(m.parts) ? m.parts : []).filter(b => b && b.byteLength);
    if (!parts.length) { fail('nothing recorded yet'); return; }
    fs.mkdirSync(CLIPS_DIR, { recursive: true });
    const name = `luna-${esTime(new Date()).replace('T', '-')}.webm`, out = path.join(CLIPS_DIR, name);
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'luna-clip-'));
    const files = parts.map((b, i) => { const f = path.join(tmp, `part${i}.webm`); fs.writeFileSync(f, Buffer.from(b)); return f; });
    const done = ok => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
      if (ok) { log(`clip saved: ${out}`); try { wc.send('luna-toast', i18n.t(cfg.language, 'replayDone', { f: name }), 3000); } catch (e) { /* ignore */ } } };
    if (files.length === 1) { fs.copyFileSync(files[0], out); done(true); return; }
    // two parts: joined, then the last 30 seconds kept (no re-encoding)
    fs.writeFileSync(path.join(tmp, 'list.txt'), files.map(f => `file '${f}'`).join('\n') + '\n');
    const joined = path.join(tmp, 'joined.webm');
    execFile('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', path.join(tmp, 'list.txt'), '-c', 'copy', joined], err => {
      if (err) { fs.copyFileSync(files[files.length - 1], out); log(`clip: couldn't join the parts (${err.message}); saved the newest part`); done(true); return; }
      execFile('ffmpeg', ['-v', 'error', '-y', '-sseof', '-30', '-i', joined, '-c', 'copy', out], err2 => {
        if (err2) { fs.copyFileSync(joined, out); log(`clip: couldn't trim to 30 s (${err2.message}); saved it whole`); }
        done(true);
      });
    });
  } catch (e) { fail(e.message); }
});

// ---------- split screen: 2-4 players on one screen ----------
// Settings > Controller > Split screen (off by default; the next time the
// app opens). Each player gets a part of the screen with their own Xbox
// page, sign-in (its own browser profile) and controller (the n-th one
// connected), and their selection in their colour: the Xbox button colours.
// Player 1 is the usual dashboard (with the app's screens); the window's
// content becomes a plain box holding every player's page.
const PLAYER_COLORS = ['#107c10', '#e81123', '#0078d7', '#ffb900'];   // A green, B red, X blue, Y yellow
const players = [];   // [{ slot, view, wc, joined, profile }]
const claims = {};    // slot -> the controller (gamepad index) that joined it
// which controller a page gets: a player's own, or (player 1) the first one
// the others haven't taken; none outside split screen
function padsFor(wc) {
  if (!cfg.split_players || !players.length) return {};
  const p = players.find(x => x.wc === wc);
  if (!p) return {};
  if (p.slot === 1) return { padExclude: Object.values(claims) };
  return claims[p.slot] != null ? { padIndex: claims[p.slot] } : { padIndex: -1 };
}
function playerSlot(wc) { const p = players.find(x => x.wc === wc); return p ? p.slot : 0; }
// the parts of the screen: side by side for 2, four quarters for 3 or 4
function splitRects(n, w, h) {
  const hw = Math.floor(w / 2), hh = Math.floor(h / 2);
  if (n === 2) return [{ x: 0, y: 0, width: hw, height: h }, { x: hw, y: 0, width: w - hw, height: h }];
  return [{ x: 0, y: 0, width: hw, height: hh }, { x: hw, y: 0, width: w - hw, height: hh },
    { x: 0, y: hh, width: hw, height: h - hh }, { x: hw, y: hh, width: w - hw, height: h - hh }].slice(0, n);
}
function playerCss(slot) {
  const c = PLAYER_COLORS[slot - 1];
  return `*:focus-visible,*:focus{outline:4px solid ${c} !important;outline-offset:2px !important;box-shadow:0 0 0 4px ${c} !important}` +
    `html::after{content:'P${slot}';position:fixed;top:6px;left:8px;z-index:2147483646;font:700 16px sans-serif;color:#fff;background:${c};padding:2px 8px;border-radius:6px;pointer-events:none}`;
}
// an Xbox page in a player's box: their colour and their controller
function playerPage(wc, slot) {
  if (/^file:/.test(wc.getURL())) return;
  const pads = padsFor(wc);
  try { wc.insertCSS(playerCss(slot)).catch(() => { /* page between loads */ }); } catch (e) { /* page closing */ }
  wc.executeJavaScript(`${PAD_GATE} window.__lunaPadFix = ${cfg.controller_fix !== false};` +
    ` window.__lunaPadIndex = ${pads.padIndex == null ? 'undefined' : pads.padIndex}; window.__lunaPadExclude = ${pads.padExclude ? JSON.stringify(pads.padExclude) : 'undefined'};`).catch(() => { /* page between loads */ });
  try { wc.send('luna-pads', pads); } catch (e) { /* ignore */ }
}
function layoutPlayers() {
  if (!mainWin || !players.length) return;
  const b = mainWin.getContentBounds(), r = splitRects(players.length, b.width, b.height);
  players.forEach((p, i) => { try { p.view.setBounds(r[i]); } catch (e) { /* ignore */ } });
  fitOverlay();
}
// ----- "Press A to join": the boxes of players 2-4 until someone takes them -----
function joinHtml(slot) {
  const L = cfg.language, T = k => i18n.t(L, k);
  const c = PLAYER_COLORS[slot - 1];
  const txt = { player: T('joinPlayer').replace('{n}', slot), press: T('joinPress'), wait: T('joinWait'), pick: T('joinPick'), guest: T('joinGuest'),
    inUse: T('joinInUse'), pin: T('joinPin'), pinBad: T('joinPinBad'), hint: T('joinHint') };
  return `<!doctype html><html lang="${L}"><head><meta charset="utf-8"><title>Player ${slot}</title><style>
  ${i18n.FONT_CSS}
  html,body{margin:0;height:100%;background:#101010;color:#eee;font-family:${i18n.FONT_STACK}}
  body{display:flex;align-items:center;justify-content:center;border:6px solid ${c};box-sizing:border-box}
  .card{text-align:center;width:min(560px,86%)}
  h1{margin:0 0 10px;font-size:44px;color:${c}}
  .big{font-size:30px;margin:18px 0}
  .muted{color:#9a9a9a;font-size:18px}
  .list{margin:14px 0;text-align:left}
  .it{padding:12px 16px;border-radius:10px;border:2px solid transparent;font-size:22px;margin:6px 0}
  .it.on{border-color:${c};background:rgba(255,255,255,.08)}
  .it.off{opacity:.45}
  .pin{font:700 40px ui-monospace,monospace;letter-spacing:12px;margin:16px 0}
  .pin span.on{color:${c};text-decoration:underline}
  </style></head><body><div class="card" id="c"></div><script>
  (function () {
    var T = ${JSON.stringify(txt).replace(/</g, '\\u003c')}, P = '${ACTION_PREFIX}', slot = ${slot};
    var st = 'wait', claimed = [], next = false, pad = -1, list = [], row = 0, pin = [0, 0, 0, 0], pi = 0, bad = false, prev = {};
    var $ = function (id) { return document.getElementById(id); };
    function esc(t) { return String(t).replace(/[&<>"]/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]; }); }
    function render() {
      var h = '<h1>' + esc(T.player) + '</h1>';
      if (st === 'wait') h += '<div class="big">' + esc(next ? T.press : T.wait) + '</div>';
      else if (st === 'pick') {
        h += '<div class="big">' + esc(T.pick) + '</div><div class="list">' + list.map(function (p, i) {
          return '<div class="it' + (i === row ? ' on' : '') + (p.inUse ? ' off' : '') + '">' + esc(p.name) + (p.inUse ? ' <span class="muted">(' + esc(T.inUse) + ')</span>' : '') + (p.locked ? ' \u{1F512}' : '') + '</div>';
        }).join('') + '</div><div class="muted">' + esc(T.hint) + '</div>';
      } else if (st === 'pin') {
        h += '<div class="big">' + esc(bad ? T.pinBad : T.pin) + '</div><div class="pin">' + pin.map(function (d, i) { return '<span' + (i === pi ? ' class="on"' : '') + '>' + d + '</span>'; }).join('') + '</div>';
      }
      $('c').innerHTML = h;
    }
    window.__joinState = function (c, n) { claimed = c || []; next = !!n; if (st === 'wait') render(); };
    window.__joinList = function (l) { list = l || []; row = 0; st = 'pick'; render(); };
    window.__pinBad = function () { bad = true; pin = [0, 0, 0, 0]; pi = 0; st = 'pin'; render(); };
    function connected() { var a = []; try { Array.prototype.forEach.call(navigator.getGamepads(), function (p) { if (p && p.connected !== false) a.push(p); }); } catch (e) {} return a; }
    function press(p, b) { var x = p.buttons[b]; var on = !!(x && (x.pressed || x.value > 0.5)); var k = p.index + ':' + b, was = prev[k]; prev[k] = on; return on && !was; }
    function dir(p) { var ax = p.axes || [], r = {}; r.up = press(p, 12) || (ax[1] < -0.6 && edge(p, 'u')); r.down = press(p, 13) || (ax[1] > 0.6 && edge(p, 'd')); r.left = press(p, 14) || (ax[0] < -0.6 && edge(p, 'l')); r.right = press(p, 15) || (ax[0] > 0.6 && edge(p, 'r'));
      ['u', 'd', 'l', 'r'].forEach(function (k) { var v = { u: ax[1] < -0.6, d: ax[1] > 0.6, l: ax[0] < -0.6, r: ax[0] > 0.6 }[k]; if (!v) prev[p.index + k] = false; }); return r; }
    function edge(p, k) { var key = p.index + k, was = prev[key]; prev[key] = true; return !was; }
    setInterval(function () {
      var pads = connected();
      if (st === 'wait') {
        // player 1 keeps the first controller nobody has taken
        var p1 = null; for (var i = 0; i < pads.length && !p1; i++) if (claimed.indexOf(pads[i].index) < 0) p1 = pads[i];
        for (var j = 0; j < pads.length; j++) {
          var p = pads[j];
          var a = press(p, 0);
          if (a && next && p !== p1 && claimed.indexOf(p.index) < 0) { pad = p.index; location.href = P + 'join-pad?slot=' + slot + '&pad=' + pad; return; }
        }
        return;
      }
      var me = null; for (var k = 0; k < pads.length; k++) if (pads[k].index === pad) me = pads[k];
      if (!me) return;
      var d = dir(me), A = press(me, 0), B = press(me, 1);
      if (st === 'pick') {
        if (d.up) row = (row + list.length - 1) % list.length;
        if (d.down) row = (row + 1) % list.length;
        if (A && list[row] && !list[row].inUse) {
          if (list[row].locked) { st = 'pin'; bad = false; pin = [0, 0, 0, 0]; pi = 0; }
          else { location.href = P + 'join-pick?slot=' + slot + '&id=' + encodeURIComponent(list[row].id); return; }
        }
        if (B) { location.href = P + 'join-leave?slot=' + slot; return; }
        render();
      } else if (st === 'pin') {
        if (d.up) pin[pi] = (pin[pi] + 1) % 10;
        if (d.down) pin[pi] = (pin[pi] + 9) % 10;
        if (d.left) pi = Math.max(0, pi - 1);
        if (d.right) pi = Math.min(3, pi + 1);
        if (A) { if (pi < 3) pi++; else { location.href = P + 'join-pick?slot=' + slot + '&id=' + encodeURIComponent(list[row].id) + '&pin=' + pin.join(''); return; } }
        if (B) { st = 'pick'; }
        render();
      }
    }, 50);
    render();
  })();
  </script></body></html>`;
}
// the box waiting next for someone to press A: the lowest one nobody has
function joinRefresh() {
  const waiting = players.filter(p => p.slot > 1 && !p.joined && claims[p.slot] == null).map(p => p.slot);
  const next = waiting.length ? Math.min.apply(null, waiting) : 0;
  for (const p of players) {
    if (p.slot === 1) { playerPage(p.wc, 1); continue; }
    if (!p.joined) { try { p.wc.executeJavaScript(`window.__joinState && window.__joinState(${JSON.stringify(Object.values(claims))}, ${p.slot === next})`).catch(() => {}); } catch (e) { /* ignore */ } }
  }
}
function joinList(slot) {
  const used = players.filter(p => p.joined && p.profile).map(p => p.profile).concat(curProfile ? [curProfile.id] : []);
  const items = profiles.list.map(p => ({ id: p.id, name: profileName(p), inUse: used.includes(p.id), locked: needsPin(p) }));
  items.push({ id: 'guest', name: i18n.t(cfg.language, 'joinGuest') });
  return items;
}
function joinAction(wc, action, q) {
  const slot = Number(q.get('slot')), pl = players.find(p => p.slot === slot);
  if (!pl) return;
  if (action === 'join-pad') {
    const pad = Number(q.get('pad'));
    if (!Number.isInteger(pad) || Object.values(claims).includes(pad)) return;
    claims[slot] = pad;
    log(`split screen: player ${slot} joined (controller ${pad})`);
    pl.wc.executeJavaScript(`window.__joinList(${JSON.stringify(joinList(slot)).replace(/</g, '\\u003c')})`).catch(() => {});
    joinRefresh();
  } else if (action === 'join-leave') {
    delete claims[slot];
    log(`split screen: player ${slot} left before picking`);
    showAppPage(pl.wc, `luna-join-${slot}.html`, joinHtml(slot));
    pl.wc.once('did-finish-load', () => joinRefresh());
    joinRefresh();
  } else if (action === 'join-pick') {
    const id = String(q.get('id') || '');
    const prof = id === 'guest' ? null : profiles.byId(id);
    if (id !== 'guest' && !prof) return;
    if (prof && needsPin(prof) && !profiles.checkPin(String(q.get('pin') || ''))) {
      log(`split screen: player ${slot}: wrong PIN for an adult profile`);
      pl.wc.executeJavaScript('window.__pinBad && window.__pinBad()').catch(() => {});
      return;
    }
    // the guest seat: forgotten when the app closes, unless Remember split-screen players is on
    const part = prof ? profiles.partition(prof) : (cfg.split_remember ? `persist:luna-player${slot}` : `luna-guest${slot}`);
    playerBox(pl, part, prof ? prof.id : '');
    log(`split screen: player ${slot} plays as ${prof ? profileName(prof) : `a guest${cfg.split_remember ? ' (remembered)' : ''}`}`);
  }
}
// a player's box becomes their own Xbox page (a new view: the browser profile
// is chosen when it's made)
function playerBox(pl, part, profileId) {
  const root = mainWin.contentView, old = pl.view;
  setupSession(part ? session.fromPartition(part) : session.defaultSession);
  const view = new WebContentsView({ webPreferences: Object.assign({ preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }, part ? { partition: part } : {}) });
  const wc = view.webContents, slot = pl.slot;
  Object.assign(pl, { view, wc, joined: true, profile: profileId });
  guard(wc);
  wc.on('dom-ready', () => { playerPage(wc, slot); if (onXboxPlay(wc.getURL())) wc.executeJavaScript(streamScript()).catch(() => { /* page between loads */ }); });
  wc.on('console-message', function (e) {
    const m = String(e && typeof e.message === 'string' ? e.message : arguments[2] || '');
    if (m.startsWith('[luna] ')) log(`player ${slot}: ${m.slice(9, 3009)}`);
  });
  try { root.addChildView(view); if (overlay) { root.removeChildView(overlay); root.addChildView(overlay); } } catch (e) { /* ignore */ }
  try { root.removeChildView(old); old.webContents.close(); } catch (e) { /* ignore */ }
  layoutPlayers();
  const prof = profileId ? profiles.byId(profileId) : null;
  const start = prof ? (profiles.settings(prof.id).start_url || cfg.start_url) : cfg.start_url;
  wc.loadURL(start).catch(e => log(`player ${slot}: couldn't open Xbox (${e.message})`));
}
function startSplit(n) {
  const View = electron.View;
  if (!View || typeof mainWin.setContentView !== 'function' || !mainWin.contentView) throw new Error('this engine has no views to split the screen with');
  const p1 = mainWin.contentView, root = new View();
  try { root.setBackgroundColor && root.setBackgroundColor('#000000'); } catch (e) { /* ignore */ }
  mainWin.setContentView(root);
  root.addChildView(p1);
  players.push({ slot: 1, view: p1, wc: mainWin.webContents, joined: true, profile: curProfile ? curProfile.id : '' });
  for (let slot = 2; slot <= n; slot++) {
    const view = new WebContentsView({ webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'luna-join', backgroundThrottling: false } });
    const pl = { slot, view, wc: view.webContents, joined: false, profile: '' };
    players.push(pl);
    guard(pl.wc);
    root.addChildView(view);
    showAppPage(pl.wc, `luna-join-${slot}.html`, joinHtml(slot));
    pl.wc.on('did-finish-load', () => { if (!pl.joined) joinRefresh(); });
  }
  mainWin.webContents.on('dom-ready', () => playerPage(mainWin.webContents, 1));
  mainWin.on('resize', layoutPlayers);
  layoutPlayers();
  log(`split screen: ${n} players; player 1 has the first controller, the others press A to join`);
}

function makeMainWin() {
  const part = profiles.partition(curProfile);
  const win = new BrowserWindow({
    fullscreen: true,
    kiosk: true,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    // shown straight away (black), so EmulationStation's screen is covered
    // the moment the app starts instead of when the first page has drawn
    show: true,
    title: 'Amazon Luna',
    webPreferences: Object.assign({
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }, part ? { partition: part } : {})
  });
  guard(win.webContents);
  // every Luna page gets the controller wrapper (standard layout for any
  // controller, and the gate the welcome popup uses) as soon as it starts
  // a restricted profile: games started from the dashboard are checked too
  win.webContents.on('did-navigate-in-page', (e, url) => pickHint(win.webContents, url));
  win.webContents.on('did-navigate-in-page', () => { if (cfg.picture_per_game) applyStreamOptions(win.webContents); });
  win.webContents.on('did-navigate', (e, url) => pickHint(win.webContents, url));
  win.webContents.on('did-navigate', (e, url) => checkAdsLaunch(win.webContents, url));
  win.webContents.on('did-navigate-in-page', (e, url) => checkAdsLaunch(win.webContents, url));
  win.webContents.on('dom-ready', () => {
    const wc = win.webContents;
    if (/^file:/.test(wc.getURL())) return;
    wc.executeJavaScript(`${PAD_GATE} window.__lunaPadFix = ${cfg.controller_fix !== false};` +
      (overlay ? ' window.__lunaPadsBlocked = true;' : '')).catch(() => { /* page between loads */ });
    if (onXboxPlay(wc.getURL())) wc.executeJavaScript(streamScript()).catch(() => { /* page between loads */ });
  });
  // the stream options' own notes go to the app's log
  // (one parameter: newer engines warn when the old message arguments are asked for;
  // older engines only have them, hence arguments[2])
  win.webContents.on('console-message', function (e) {
    const m = String(e && typeof e.message === 'string' ? e.message : arguments[2] || '');
    if (m.startsWith('[luna] ')) log(m.slice(9, 3009));
  });
  win.focus();
  win.once('ready-to-show', () => { win.show(); win.focus(); win.webContents.focus(); });
  // the window closed some other way (Alt+F4): the app's own exit, so the
  // sign-in is saved (and Sign out when closing still applies)
  win.on('close', e => { if (!exiting && mainWin === win) { e.preventDefault(); fastExit('window closed (Alt+F4)'); } });
  win.on('closed', () => { if (mainWin === win) mainWin = null; });
  win.on('resize', fitOverlay);
  return win;
}

// switch the dashboard to another profile: its own sign-in and settings
function switchTo(p, why) {
  log(`profile: ${p ? (p.name || p.id) : 'none'} (${why})`);
  curProfile = p || null;
  if (p) profiles.setLast(p.id);
  // a child's or teen's profile: the adults' profiles are locked again
  if (isMinor(p)) unlockedId = '';
  Object.assign(cfg, loadConfig(p && p.id));
  identitySeen = '';
  setupSession(curSession());
  const old = mainWin;
  const win = makeMainWin();
  mainWin = win;
  applyUserAgent();
  if (overlay && old && old !== win) {
    try { old.contentView.removeChildView(overlay); } catch (e) { /* ignore */ }
    try { win.contentView.addChildView(overlay); fitOverlay(); } catch (e) { /* ignore */ }
  }
  siteReady = false;
  openStart(win.webContents);
  if (old && old !== win) { try { old.destroy(); } catch (e) { /* ignore */ } }
  try { overlay && overlay.webContents.focus(); } catch (e) { /* ignore */ }
}

function createWindow() {
  Menu.setApplicationMenu(null);
  mainWin = makeMainWin();
  if (SETTINGS_MODE) {
    // adult profiles are behind the PIN, here too
    if (needsPin(curProfile)) showPin(mainWin.webContents, { kind: 'settings', id: curProfile.id });
    else openSettings(mainWin.webContents, 'exit');
    return;
  }
  if (cfg.split_players >= 2 && !GAME_ID) {
    try { startSplit(cfg.split_players); } catch (e) { players.length = 0; log(`split screen not started: ${e.message}; one player`); }
  }
  // Luna starts loading straight away, behind the intro video. A game from
  // Batocera's list with more than one profile: only the dashboard until
  // someone picks who's playing, so the game never starts in the wrong account
  openStart(mainWin.webContents, GAME_ID && startPickerDue());
  if (GAME_ID) {
    // a game picked in Batocera's list: straight into it (no intro or welcome
    // screen); only "who's playing?" first, when there's more than one profile
    introDone = true;
    if (startPickerDue()) whenSiteReady(() => { if (!overlay) openOverlay('profiles'); }, 8000);
    else gameDone = true;
    return;
  }
  if (introDue() && fs.existsSync(INTRO_VIDEO)) {
    try { fs.writeFileSync(INTRO_LAST, today() + '\n'); } catch (e) { /* ignore */ }
    openOverlay('video');
  }
  else {
    introDone = true;
    if (welcomeShown()) whenSiteReady(() => openOverlay('welcome'), 8000);
    else if (startPickerDue()) whenSiteReady(() => { if (!overlay) openOverlay('profiles'); }, 8000);
  }
}

function preloadText() {
  const L = cfg.language;
  const keys = ['hintPad', 'pressAny', 'controller', 'connected', 'holdExit', 'padGone', 'padBack', 'kShift', 'kSpace', 'kDel', 'kDone', 'kHide', 'kText', 'homeBtn', 'homeHint', 'rowNone', 'rowHint',
    'qpTitle', 'qpAudio', 'qpVideo', 'qpHint', 'qpShot', 'qpShotGo', 'qpSaveGo', 'qpTip', 'upT', 'utT', 'utScreen', 'usT', 'cleanT', 'qpGame', 'statsT', 'qpReplay', 'volume', 'boostT', 'shT', 'clT', 'saT', 'ctT', 'brT', 'on', 'off', 'shLow', 'shMed', 'shHigh', 'muted'];
  const text = Object.fromEntries(keys.map(k => [k, i18n.t(L, k)]));
  // the Japanese / Korean letters, for the keyboard and messages on the Luna page
  return { lang: L, text, fontCss: L === 'ja' || L === 'ko' ? i18n.FONT_CSS : '', fontStack: i18n.FONT_STACK };
}
// the volume the Luna page plays at: 0 when muted in Settings
function appVolume() { return cfg.muted ? 0 : cfg.volume; }
ipcMain.on('luna-config', event => {
  event.returnValue = Object.assign(padsFor(event.sender), { dashNav: cfg.dashboard_nav, replay: cfg.replay, touch: cfg.touch_controller, exitHoldMs: Math.round(cfg.exit_hold_seconds * 1000), keyHighlight: cfg.keyboard_highlight, padFix: cfg.controller_fix !== false, volume: appVolume(), i18n: preloadText(),
    stream: (() => { try { return onXboxPlay(event.sender.getURL()) ? streamScript() : ''; } catch (e) { return ''; } })() });
});
// the controller's Menu button on the welcome screen
ipcMain.on('luna-settings', event => openSettings(event.sender, 'welcome'));
// Backspace on the dashboard: Settings, over the dashboard
ipcMain.on('luna-settings-dash', () => {
  if (overlay || SETTINGS_MODE) return;
  log('settings opened with Backspace on the dashboard');
  openOverlay('settings');
});
// F8 on a game's page: the game goes into Batocera's list (Games I pick),
// or comes out of it if it's there already
let f8Last = 0;
ipcMain.on('luna-pick-toggle', (event, href, also, docTitle) => {
  if (overlay || SETTINGS_MODE || Date.now() - f8Last < 800) return;
  f8Last = Date.now();
  let url = String(href || '');
  try { if (!url) url = mainWin.webContents.getURL(); } catch (e) { /* closed */ }
  if (cfg.game_list !== 'picked') { log(`F8: the game list is "${cfg.game_list}", not Games I pick`); mainToast('f8Mode', null, 6000); return; }
  const tries = [url].concat(Array.isArray(also) ? also.map(String) : []);
  let g = null;
  // the page's own title, as the game's name when nothing better is known ("Play Fortnite | Amazon Luna - ...")
  let pageTitle = String(docTitle || '').split(/\s+[|\u2013\u2014-]\s+/)[0].trim().replace(/^play\s+/i, '');
  if (/^(amazon|luna)\b/i.test(pageTitle) || pageTitle.length > 80) pageTitle = '';
  for (const t of tries) { g = gameFromUrl(t, pageTitle); if (g) break; }
  if (!g) { log(`F8: no game on this page (${tries.join(' | ')})`); mainToast('f8NoGame', null, 5000); return; }
  const list = pickedGames(), has = list.some(x => x.id === g.id);
  const next = has ? list.filter(x => x.id !== g.id) : list.concat([{ id: g.id, slug: g.slug.slice(0, 120) }]);
  try { fs.writeFileSync(PICKED_FILE, JSON.stringify(next, null, 2) + '\n'); } catch (e) { log(`could not save the picked games: ${e.message}`); mainToast('glFail'); return; }
  log(`F8: ${has ? 'removed' : 'added'} ${g.title} (${g.id}) ${has ? 'from' : 'to'} Batocera's list`);
  mainToast(has ? 'f8Removed' : 'f8Added', { game: g.title }, 4000);
  runGameList('picked', 'F8', false);
});
// the app's on-screen keyboard opened / closed on the dashboard (search):
// Luna doesn't see the controller while it's typing
ipcMain.on('luna-osk', (event, open) => {
  try { event.sender.executeJavaScript(`${PAD_GATE} window.__lunaOsk = ${open ? 'true' : "'release'"};`).catch(() => {}); } catch (e) { /* ignore */ }
});
// the on-screen number pad: real key presses, so code boxes (one digit each)
// take the digit and move on to the next box as they do with a keyboard
ipcMain.on('luna-key', (event, key) => {
  const wc = event.sender;
  if (!wc || typeof wc.sendInputEvent !== 'function') return;
  try {
    if (key === 'Backspace') {
      wc.sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' });
      wc.sendInputEvent({ type: 'keyUp', keyCode: 'Backspace' });
    } else if (/^[0-9]$/.test(String(key))) {
      wc.sendInputEvent({ type: 'keyDown', keyCode: key });
      wc.sendInputEvent({ type: 'char', keyCode: key });
      wc.sendInputEvent({ type: 'keyUp', keyCode: key });
    }
  } catch (e) { log(`on-screen number pad: ${e.message}`); }
});
// the controller in use, as any page last saw it: the profile and PIN
// screens show its button names before they've seen it themselves
let lastPadId = '';
ipcMain.on('luna-pad-seen', (event, id) => { if (typeof id === 'string' && id.length < 300) lastPadId = id; });
ipcMain.on('luna-last-pad', event => { event.returnValue = lastPadId; });
// Menu held while on Luna: show the welcome screen
ipcMain.on('luna-welcome', () => {
  if (overlay) return;
  log('welcome screen opened (Menu held)');
  openOverlay('welcome');
});
// the controller skipped the intro video
ipcMain.on('luna-intro-done', () => afterIntro());
// "Home" on any page that isn't the dashboard (Prime / Luna sign-up, account
// pages, sign-in): back to Amazon Luna
ipcMain.on('luna-home', event => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && mainWin && win !== mainWin) {
    log('home: closing a pop-up window');
    try { win.close(); } catch (e) { /* ignore */ }
    try { mainWin.focus(); mainWin.webContents.focus(); } catch (e) { /* ignore */ }
    return;
  }
  log('home: back to the dashboard');
  if (mainWin) openStart(mainWin.webContents);
});
ipcMain.on('luna-quit', () => fastExit('controller, exit buttons held'));
ipcMain.on('luna-retry', event => { log('retry from the "can\'t connect" screen (controller)'); openStart(event.sender); });
ipcMain.on('luna-continue', (event, opts) => doContinue(event.sender, !!(opts && opts.never), 'controller'));
// the dashboard's "Hold View: open <row>" hint: shown the first few times
// only, and never again once a row has been opened that way
const ROW_HINT_FILE = path.join(HOME, 'row-hint-count'), ROW_HINT_MAX = 5;
function rowHintCount() { try { return parseInt(fs.readFileSync(ROW_HINT_FILE, 'utf8'), 10) || 0; } catch (e) { return 0; } }
ipcMain.on('luna-row-hint', event => {
  const n = rowHintCount();
  if (n >= ROW_HINT_MAX) { event.returnValue = false; return; }
  try { fs.writeFileSync(ROW_HINT_FILE, String(n + 1)); } catch (e) { /* ignore */ }
  event.returnValue = true;
});
ipcMain.on('luna-row-used', () => { try { fs.writeFileSync(ROW_HINT_FILE, String(ROW_HINT_MAX)); } catch (e) { /* ignore */ } });
ipcMain.on('luna-log', (event, msg) => log(String(msg).slice(0, 3000)));

app.on('second-instance', () => {
  if (mainWin) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.focus(); }
});

app.whenReady().then(() => {
  setTimeout(logGpu, 5000);
  log(`starting Amazon Luna ${VERSION} (${batoceraVersion()}, Electron ${process.versions.electron}, Chrome ${process.versions.chrome})`);
  // the version used last time: an update (from Settings > Updates, or a reinstall) is noted once
  try {
    const lastFile = path.join(HOME, 'last-version');
    let before = '';
    try { before = fs.readFileSync(lastFile, 'utf8').trim(); } catch (e) { /* first run */ }
    if (before && before !== VERSION) {
      log(`updates: the app was updated from v${before} to v${VERSION}`);
      try { fs.writeFileSync(WHATSNEW_DUE, VERSION + '\n'); } catch (e) { /* ignore */ }
    }
    // a first start on a smaller (ARM) device: the low-power settings are offered once
    if (!before && !X64 && !fs.existsSync(LOWPOWER_ASKED)) { try { fs.writeFileSync(LOWPOWER_ASKED + '-due', 'x'); } catch (e) { /* ignore */ } }
    if (before !== VERSION) fs.writeFileSync(lastFile, VERSION + '\n');
  } catch (e) { /* ignore */ }
  // keep the screen awake: playing with only a controller doesn't count as
  // activity for the screen blanking, which watches the keyboard and mouse
  try { powerSaveBlocker.start('prevent-display-sleep'); } catch (e) { /* ignore */ }
  const nudge = () => execFile('xset', ['s', 'reset'], { env: Object.assign({}, process.env, { DISPLAY: process.env.DISPLAY || ':0.0' }) }, () => {});
  nudge();
  setInterval(nudge, 50 * 1000).unref();
  // controller batteries: once a minute
  if (!SETTINGS_MODE) setInterval(padWatch, Number(process.env.LUNA_PADWATCH_MS) || 2000).unref();
  if (!SETTINGS_MODE) setInterval(checkPadBatteries, Number(process.env.LUNA_BATTERY_MS) || 60 * 1000).unref();
  // "Games I pick" was turned on from the F1 Settings shortcut: the how-to now
  if (cfg.game_list === 'picked' && fs.existsSync(PICK_TIP_DUE)) {
    try { fs.unlinkSync(PICK_TIP_DUE); } catch (e) { /* ignore */ }
    if (!SETTINGS_MODE && !GAME_ID) whenSiteReady(() => pickTipDue(), 8000);
  }
  if (SAFE_ARG) setTimeout(() => safeMode('--safe'), 3000);
  // the one-time cards: what's new after an update; the low-power settings on an ARM device's first start
  if (!SETTINGS_MODE && !GAME_ID) {
    if (fs.existsSync(LOWPOWER_ASKED + '-due') && !fs.existsSync(LOWPOWER_ASKED)) {
      whenSiteReady(() => { try { fs.unlinkSync(LOWPOWER_ASKED + '-due'); } catch (e) { /* ignore */ } queuePrompt({ kind: 'lowpower' }); }, 10000);
    } else if (fs.existsSync(WHATSNEW_DUE)) {
      whenSiteReady(() => { try { fs.unlinkSync(WHATSNEW_DUE); } catch (e) { /* ignore */ } queuePrompt({ kind: 'whatsnew' }); }, 10000);
    }
  }
  // Batocera's game list: kept up to date (Luna's games change every month)
  if (cfg.game_list !== 'off') {
    const gs = glState();
    // (also when 3D game boxes are on but aren't drawn yet, e.g. turned on from the F1 Settings shortcut)
    const boxesDue = cfg.game_list_3d && gs.count > 0 && !gs.box3d;
    if (gs.mode !== cfg.game_list || !gs.synced || Date.now() / 1000 - gs.synced > 3 * 86400 || boxesDue) setTimeout(() => runGameList(cfg.game_list, boxesDue ? '3D game boxes' : 'refresh', false), boxesDue ? 8000 : 20000);
  }
  setupSession(curSession());
  applyUserAgent();
  if (profiles.active) log(`profiles: ${profiles.list.map(p => p.name || p.id).join(', ')}; starting with ${curProfile ? (curProfile.name || curProfile.id) : '-'}`);

  createWindow();
});

app.on('window-all-closed', () => app.quit());
