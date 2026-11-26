#!/usr/bin/env python3
"""Fills Batocera's Luna list with the Luna games themselves.

Settings > EmulationStation game list in the app runs this:
  Sync-GameList.py all      every game on Amazon Luna (Luna's own list of its games)
  Sync-GameList.py picked   only the games picked in the app (picked-games.json)
  Sync-GameList.py off      back to the single "Amazon Luna" entry
                            (picking Luna opens the app straight away)
Options: --site luna.amazon.com (the Luna site of the region, default luna.amazon.com)

Each game gets a small file in /userdata/roms/luna (it holds the game's Luna
ID, the B0... in its address, which the app opens), an entry in gamelist.xml
with its name and description, and its picture, all from the game's own page
on Luna. With "3D game boxes" on in the app's Settings, a game whose picture
fits a game case (a tall cover, not a wide banner) gets a 3D case drawn from
it (gamebox3d.py, needs Pillow; without Pillow the app draws them); the others
keep their flat picture.
Only files this script made are ever removed; games' play counts and
favourites set in Batocera are kept.

The game list comes from Luna's public site map (https://luna.amazon.com/
sitemap.xml, the list Luna gives search engines), the details from each game's
public page. Neither needs a sign-in, and nothing is sent to Amazon but the
pages asked for. A game's details are kept for a week, so a refresh only asks
for the new ones. Progress is printed as one JSON object per line.

It keeps going if the app closes before it's done: the games are listed
first, with whatever pictures are already there, then the pictures come in;
what's left goes to luna-app.log, and EmulationStation is asked to reload its
games when it's finished. Two runs never overlap: a second one waits for the
first.
"""
import fcntl, json, os, re, shutil, subprocess, sys, tempfile, time, urllib.parse, urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor

FILES = os.environ.get("LUNA_HOME", "/userdata/system/add-ons/luna")
ROMS = os.environ.get("LUNA_ROMS", "/userdata/roms/luna")
IMAGES = os.path.join(ROMS, "images")
GAMELIST = os.path.join(ROMS, "gamelist.xml")
STATE = os.path.join(FILES, "gamelist-state.json")
PICKED = os.path.join(FILES, "picked-games.json")
CONFIG = os.path.join(FILES, "config.json")
LS_LIST = os.environ.get("LUNA_LAUNCHSINGLE_LIST", "/userdata/system/launchsingle.systems")
LS_SCRIPT = os.environ.get("LUNA_LAUNCHSINGLE_SCRIPT", "/userdata/system/configs/emulationstation/scripts/game-selected/launchsingle-launch.sh")
CHANGED = os.environ.get("LUNA_GAMELIST_FLAG", "/tmp/luna-gamelist-changed")
APP_LOG = os.environ.get("LUNA_APP_LOG", "/userdata/system/logs/luna-app.log")
LOCK = os.path.join(FILES, ".gamelist.lock")
RELOAD_URL = os.environ.get("LUNA_ES_RELOAD", "http://127.0.0.1:1234/reloadgames")
PARENT = os.getppid()
# Luna's sites (one per country); the game list and pages come from the one in use
SITE_RE = re.compile(r"^luna\.amazon\.(com|ca|co\.uk|de|fr|it|es|nl|pl|com\.be|pt|se)$", re.I)
SITEMAP = os.environ.get("LUNA_SITEMAP_URL", "")          # (for the tests: instead of https://<site>/sitemap.xml)
PAGE_URL = os.environ.get("LUNA_PAGE_URL", "")            # (for the tests: "{base}/{slug}/{id}" instead of the site)
DASHBOARD = "./Amazon Luna.luna"
SETTINGS_ENTRY = "./Amazon Luna Settings.luna"
OWN = (DASHBOARD, SETTINGS_ENTRY)   # the app's own entries, always in the list
# a browser's way of asking (Luna's pages turn some programs away)
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
# a Luna game's ID: the 10 letters and digits at the end of its address (an Amazon ASIN, B0...)
ID_RE = re.compile(r"^[0-9A-Z]{10}$")
GAME_LINK = re.compile(r"/game/([^/?#<\s]+)/([0-9A-Za-z]{10})(?:[/?#<\s]|$)")
# the play counts and choices Batocera keeps for a game, kept across updates
KEEP_TAGS = ("playcount", "lastplayed", "gametime", "favorite", "hidden")
# a game's details are asked for again after this long (they rarely change)
DETAILS_DAYS = 7


_alone = []
def alone():
    """The app that started this has closed (its end of the pipe is gone)."""
    if not _alone and os.getppid() != PARENT:
        went_alone()
    return bool(_alone)


def went_alone():
    if _alone:
        return
    _alone.append(1)
    try:  # nothing reads what's printed any more
        fd = os.open(os.devnull, os.O_WRONLY)
        os.dup2(fd, 1)
        os.close(fd)
    except OSError:
        pass
    log("the app closed before the list was finished; carrying on in the background")


def log(msg):
    try:
        with open(APP_LOG, "a", encoding="utf-8") as f:
            f.write(time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + "Z Batocera game list: " + msg + "\n")
    except OSError:
        pass


def emit(**kw):
    if not alone():
        try:
            print(json.dumps(kw), flush=True)
            return
        except (BrokenPipeError, OSError):
            went_alone()
    # after the app has gone: what matters goes to its log instead
    if "warning" in kw:
        log(kw["warning"])
    elif "error" in kw:
        log(f"couldn't update ({kw['error']})")
    elif kw.get("stage") == "listed":
        log(f"{kw.get('count')} games listed; their pictures are still coming")
    elif kw.get("done"):
        log(f"{kw.get('count')} games, finished after the app closed")


def app_running():
    """The Amazon Luna app (its browser engine) is open."""
    me = os.path.join(FILES, "runtime") + "/"
    for pid in os.listdir("/proc"):
        if not pid.isdigit():
            continue
        try:
            with open(f"/proc/{pid}/cmdline", "rb") as f:
                if me.encode() in f.read():
                    return True
        except OSError:
            pass
    return False


def reload_es():
    """When the app is closed, EmulationStation shows the new list straight away
    (with the app open, its launcher asks for this when it closes)."""
    if not alone() or app_running():
        return
    try:
        urllib.request.urlopen(RELOAD_URL, timeout=5).read()
        try:
            os.remove(CHANGED)
        except OSError:
            pass
        log("EmulationStation reloaded its games")
    except Exception as e:
        log(f"couldn't ask EmulationStation to reload ({e}); it shows after a restart or Update game lists")


def read_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def write_atomic(path, data, binary=False):
    d = os.path.dirname(path)
    fd, tmp = tempfile.mkstemp(dir=d, prefix=".tmp-")
    with os.fdopen(fd, "wb" if binary else "w", **({} if binary else {"encoding": "utf-8"})) as f:
        f.write(data)
    os.replace(tmp, path)


def get(url, accept="application/json", timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": accept, "Accept-Language": "en-US,en;q=0.8"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def site_of(args):
    """The Luna site to read (--site), else the one in config.json, else the US one."""
    site = args[args.index("--site") + 1] if "--site" in args and args.index("--site") + 1 < len(args) else ""
    if not site:
        try:
            site = urllib.parse.urlparse(read_json(CONFIG, {}).get("start_url", "")).hostname or ""
        except Exception:
            site = ""
    return site.lower() if SITE_RE.match(site or "") else "luna.amazon.com"


# ---------- which games ----------
def sitemap_games(site):
    """[(id, slug)]: every game Luna lists in its site map, in its order."""
    text = get(SITEMAP or f"https://{site}/sitemap.xml", "application/xml,text/xml,*/*").decode("utf-8", "replace")
    out, seen = [], set()
    for loc in re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", text):
        m = GAME_LINK.search(loc)
        if not m:
            continue
        gid = m.group(2).upper()
        if ID_RE.match(gid) and gid not in seen:
            seen.add(gid)
            out.append((gid, m.group(1)))
    return out


def picked_games():
    """[(id, slug)] picked in the app (F8 / Settings)."""
    out, seen = [], set()
    for p in read_json(PICKED, []):
        gid = str(p.get("id", "") if isinstance(p, dict) else p).upper()
        slug = str(p.get("slug", "") if isinstance(p, dict) else "") or "game"
        if ID_RE.match(gid) and gid not in seen:
            seen.add(gid)
            out.append((gid, re.sub(r"[^A-Za-z0-9._~-]", "-", slug)[:120] or "game"))
    return out


# ---------- details from each game's page ----------
def meta_of(html):
    """{name: content} of a page's <meta> tags (property= or name=)."""
    out = {}
    for tag in re.findall(r"<meta\b[^>]*>", html, re.I):
        key = re.search(r"\b(?:property|name)\s*=\s*([\"'])(.*?)\1", tag, re.I | re.S)
        val = re.search(r"\bcontent\s*=\s*([\"'])(.*?)\1", tag, re.I | re.S)
        if key and val and key.group(2).lower() not in out:
            out[key.group(2).lower()] = html_unescape(val.group(2))
    return out


def html_unescape(t):
    import html as _h
    return _h.unescape(t or "").strip()


def clean_title(t, slug):
    """"Play Fortnite Battle Royale | Amazon Luna - No Download Required" -> "Fortnite Battle Royale"."""
    t = re.split(r"\s+[|\u2013\u2014]\s+", t or "")[0].strip()
    t = re.sub(r"\s+-\s+Amazon Luna.*$", "", t, flags=re.I).strip()
    t = re.sub(r"^(play|jouer à|jouer a|spiele|spielen|gioca a|juega a|jogar|jogue|speel|zagraj w|spela)\s+", "", t, flags=re.I).strip()
    if not t or re.match(r"^amazon luna\b", t, re.I):
        t = urllib.parse.unquote(slug or "").replace("-", " ").strip().title()
    return t


def page_url(site, gid, slug):
    if PAGE_URL:
        return PAGE_URL.format(slug=slug, id=gid)
    return f"https://{site}/game/{urllib.parse.quote(slug, safe='-._~')}/{gid}"


def details(games, site, state, keep_missing=False):
    """{id: details}; from the cache in state when it's recent, else from the game's page."""
    cache = state.setdefault("details", {})
    now = time.time()
    out, todo = {}, []
    for gid, slug in games:
        c = cache.get(gid)
        if c and c.get("site") == site and now - c.get("t", 0) < DETAILS_DAYS * 86400 and c.get("title"):
            out[gid] = c
        else:
            todo.append((gid, slug))

    def one(job):
        gid, slug = job
        try:
            html = get(page_url(site, gid, slug), "text/html,*/*", 30).decode("utf-8", "replace")
        except Exception as e:
            return gid, None, str(e)
        m = meta_of(html)
        title = clean_title(m.get("og:title") or m.get("title") or m.get("twitter:title") or "", slug)
        if not title:
            t = re.search(r"<title[^>]*>(.*?)</title>", html, re.I | re.S)
            title = clean_title(html_unescape(t.group(1)) if t else "", slug)
        img = m.get("og:image") or m.get("twitter:image") or ""
        return gid, {
            "title": title,
            "slug": slug,
            "desc": (m.get("og:description") or m.get("description") or m.get("twitter:description") or "").strip(),
            "art": img if img.startswith("https://") or (PAGE_URL and img.startswith("http://127.0.0.1")) else "",
            "site": site, "t": now,
        }, ""

    failed = 0
    with ThreadPoolExecutor(6) as pool:
        for n, (gid, d, err) in enumerate(pool.map(one, todo), 1):
            if d:
                out[gid] = cache[gid] = d
            else:
                failed += 1
                old = cache.get(gid)
                if old and old.get("title"):
                    out[gid] = old            # last time's details, rather than nothing
                if failed <= 3:
                    emit(warning=f"couldn't read {gid}'s Luna page ({err})")
            if n % 10 == 0 or n == len(todo):
                emit(stage="details", done=n, total=len(todo))
    # a game picked but whose page couldn't be read still goes in, by the name in
    # its address (with "All Luna games", one whose page doesn't open is left out)
    for gid, slug in games:
        if keep_missing and gid not in out:
            out[gid] = {"title": clean_title("", slug), "slug": slug, "desc": "", "art": "", "site": site, "t": 0}
    for d in out.values():
        d.setdefault("desc", "")
    # forget the details of games no longer around (keeps the state file small)
    keep = {g for g, _ in games} | set(state.get("games", {}))
    for gid in list(cache):
        if gid not in keep:
            del cache[gid]
    return out


# ---------- pictures ----------
def ext_of(data):
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return ".png"
    if data[:3] == b"\xff\xd8\xff":
        return ".jpg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    return ""


def fetch_image(job):
    """job: (address, where without its extension[, another address to try])."""
    url, base = job[0], job[1]
    for e in (".jpg", ".png", ".webp"):
        if os.path.exists(base + e):
            return base + e
    data = b""
    for u in [url] + list(job[2:]):
        if not u:
            continue
        try:
            data = get(u, "image/*", 30)
        except Exception:
            data = b""
        if ext_of(data):
            break
    e = ext_of(data)
    if not e:
        return ""
    try:
        write_atomic(base + e, data, binary=True)
    except OSError as err:
        # a picture that can't be saved (a read-only folder, a full disk)
        # doesn't stop the list: the game is still added or taken out
        note_unsaved(err)
        return ""
    return base + e


_unsaved = []
def note_unsaved(err):
    if not _unsaved:
        _unsaved.append(err)
        emit(warning=f"pictures couldn't be saved ({err}); the list is updated without them")


def sized(url, w):
    """Amazon's pictures come in any width: ...91nwb7ISQ6L.png -> ...91nwb7ISQ6L._SX480_.png"""
    if not url:
        return ""
    m = re.match(r"^(https://[a-z0-9.-]*media-amazon\.com/images/[^?#]+?)(\._[^/]*_)?(\.(?:jpg|jpeg|png|webp|gif))$", url, re.I)
    return f"{m.group(1)}._SX{w}_{m.group(3)}" if m else url


# ---------- gamelist.xml ----------
def single_launched():
    """True when Launch Single Game opens the app as soon as luna is picked in
    the carousel. It only does that with a single file in the folder, so then
    there's no " Amazon Luna Settings" entry (its list is never seen anyway;
    Settings is in the app and in F1 > Applications)."""
    if not os.path.exists(LS_SCRIPT):
        return False
    try:
        lines = open(LS_LIST, encoding="utf-8").read().replace("\r", "").split("\n")
    except FileNotFoundError:
        return True   # no list: it acts on every system
    except Exception:
        return False
    return any(l.strip() == "luna" for l in lines if not l.strip().startswith("#"))


def load_gamelist(with_settings=True):
    """Batocera's list as it is (a damaged one is left alone), with the app's
    own entries: " Amazon Luna" and (with_settings) " Amazon Luna Settings"."""
    if os.path.exists(GAMELIST):
        try:
            root = ET.parse(GAMELIST).getroot()
        except ET.ParseError as e:
            raise RuntimeError(f"{GAMELIST} couldn't be read ({e}); it was left as it is")
    else:
        root = ET.Element("gameList")
    have = {g.findtext("path") or "" for g in root.findall("game")}
    try:
        ours = ET.parse(os.path.join(FILES, "gamelist.xml")).getroot().findall("game")
    except Exception:
        ours = []
    for i, g in enumerate(ours):
        p = g.findtext("path") or ""
        if p not in have and (with_settings or p != SETTINGS_ENTRY):
            root.insert(i, g)
    # the settings entry's placeholder file, so EmulationStation lists it
    settings_file = os.path.join(ROMS, SETTINGS_ENTRY[2:])
    if with_settings and not os.path.exists(settings_file):
        try:
            with open(settings_file, "w", encoding="utf-8") as f:
                f.write("Placeholder for Amazon Luna's settings. Launching it opens the app's settings screen.\n")
        except OSError:
            pass
    elif not with_settings:
        for g in list(root.findall("game")):
            if (g.findtext("path") or "") == SETTINGS_ENTRY:
                root.remove(g)
        try:
            os.remove(settings_file)
        except OSError:
            pass
    return root


PINNED = " Amazon Luna"   # a space first: it sorts before every letter, number and symbol


def pin_first(g):
    """The app's own entries stay at the top of the list (" Amazon Luna", then
    " Amazon Luna Settings"): their sort name for EmulationStation versions
    that use one (Batocera since December 2025, HippOS), and their name for
    the ones that sort by the name itself; both start with a space."""
    pinned = PINNED + (" Settings" if (g.findtext("path") or "") == SETTINGS_ENTRY else "")
    sn = g.find("sortname")
    if sn is None:
        sub(g, "sortname", pinned)
    elif not (sn.text or "").startswith(" "):   # "!Amazon Luna" from earlier versions
        sn.text = pinned
    n = g.find("name")
    if n is None:
        n = ET.SubElement(g, "name")
    if not (n.text or "").startswith(" "):
        n.text = " " + (n.text or pinned).strip()


def sub(game, tag, text):
    if text:
        ET.SubElement(game, tag).text = text


def safe_name(title):
    t = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "", title).strip().rstrip(".")
    return (t or "Game")[:120]


def write_gamelist(root):
    ET.indent(root, "  ") if hasattr(ET, "indent") else None
    write_atomic(GAMELIST, '<?xml version="1.0"?>\n' + ET.tostring(root, encoding="unicode") + "\n")


def set_launchsingle(on, state):
    """luna in Launch Single Game's list: out while the games are listed, back
    after (only if it was there, and single launch wasn't turned down at install)."""
    try:
        lines = open(LS_LIST, encoding="utf-8").read().replace("\r", "").split("\n")
    except Exception:
        return
    has = any(l.strip() == "luna" for l in lines)
    if not on and has:
        lines = [l for l in lines if l.strip() != "luna"]
        state["launchsingle_removed"] = True
    elif on and not has and state.get("launchsingle_removed") and read_json(CONFIG, {}).get("single_launch", True) is not False:
        lines = [l for l in lines if l != ""] + ["luna"]
        state.pop("launchsingle_removed", None)
    else:
        return
    write_atomic(LS_LIST, "\n".join(lines).rstrip("\n") + "\n")


def remove_ours(state, keep_ids=()):
    """Delete the game files and pictures this script made (not the ones kept)."""
    gone = []
    for pid, info in list(state.get("games", {}).items()):
        if pid in keep_ids:
            continue
        for f in [info.get("file", "")] + info.get("images", []):
            if f:
                p = os.path.join(ROMS, f[2:] if f.startswith("./") else f)
                try:
                    os.remove(p)
                except FileNotFoundError:
                    pass
                except OSError as err:   # can't be deleted (read-only folder): it's out of the list anyway
                    emit(warning=f"couldn't delete {os.path.basename(p)} ({err})")
        gone.append(info.get("file", ""))
        del state["games"][pid]
    return gone


# the pictures this script saves are named after the game's Luna ID
OUR_PICTURE = re.compile(r"^([0-9A-Z]{10})-(image|marquee|fanart|poster|box3d|cover)\.(jpg|png|webp)(\.tmp(\.png|\.jpg)?)?$")


def sweep_pictures(keep_ids=()):
    """Delete every picture this script saved for a game not in keep_ids, also ones
    a run cut short never wrote down (your own pictures, named otherwise, stay)."""
    n = 0
    try:
        names = os.listdir(IMAGES)
    except OSError:
        return 0
    for f in names:
        m = OUR_PICTURE.match(f)
        if m and m.group(1) not in keep_ids:
            try:
                os.remove(os.path.join(IMAGES, f))
                n += 1
            except OSError:
                pass
    return n


def ours(g):
    """A gamelist.xml entry this script wrote: its picture is one of ours."""
    for t in ("image", "thumbnail", "marquee", "fanart"):
        v = os.path.basename(g.findtext(t) or "")
        if OUR_PICTURE.match(v):
            return True
    return False


# ---------- 3D game boxes ----------
def image_size(path):
    """(width, height) of a PNG, JPEG or WebP file, read from its header (no
    Pillow needed), or None."""
    try:
        with open(path, "rb") as f:
            head = f.read(64)
            if head[:8] == b"\x89PNG\r\n\x1a\n":
                return int.from_bytes(head[16:20], "big"), int.from_bytes(head[20:24], "big")
            if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
                kind = head[12:16]
                if kind == b"VP8 ":
                    return int.from_bytes(head[26:28], "little") & 0x3FFF, int.from_bytes(head[28:30], "little") & 0x3FFF
                if kind == b"VP8L":
                    b = int.from_bytes(head[21:25], "little")
                    return (b & 0x3FFF) + 1, ((b >> 14) & 0x3FFF) + 1
                if kind == b"VP8X":
                    return int.from_bytes(head[24:27], "little") + 1, int.from_bytes(head[27:30], "little") + 1
                return None
            if head[:2] == b"\xff\xd8":
                f.seek(2)
                while True:
                    m = f.read(2)
                    if len(m) < 2 or m[0] != 0xFF:
                        return None
                    if m[1] in (0xD8, 0x01) or 0xD0 <= m[1] <= 0xD7:
                        continue
                    n = int.from_bytes(f.read(2), "big")
                    if m[1] in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                        b = f.read(5)
                        return int.from_bytes(b[3:5], "big"), int.from_bytes(b[1:3], "big")
                    f.seek(n - 2, 1)
    except Exception:
        pass
    return None


ART_RATIO = (640 - 2 * 11) / (960 - 86 - 5 - 11)   # gamebox3d.ART_RATIO
MAX_CROP = 0.20                                    # gamebox3d.MAX_CROP
BOX_VERSION = 1                                    # gamebox3d.VERSION, for when Pillow isn't here


def fits_case(path):
    """True when the picture is tall enough for a game case: it loses at most
    a fifth of its width or height (gamebox3d.fits)."""
    wh = image_size(path) if path else None
    if not wh or not wh[0] or not wh[1]:
        return False
    r = wh[0] / wh[1]
    lost = 1 - ART_RATIO / r if r > ART_RATIO else 1 - r / ART_RATIO
    return lost <= MAX_CROP


def make_boxes(info, got, state):
    """{id: path of its 3D case} for the games whose picture fits a case; the
    others keep their flat picture. Without Pillow the app draws them."""
    covers = {}
    for pid, d in info.items():
        art = got.get(os.path.join(IMAGES, f"{pid}-image"))
        if art and fits_case(art):
            covers[pid] = art
    skipped = len([p for p in info if got.get(os.path.join(IMAGES, f"{p}-image"))]) - len(covers)
    if skipped:
        emit(warning=f"{skipped} game(s) keep their flat picture: it doesn't fit a game case (too wide)")
    sig = lambda p: f"{os.path.getsize(p)}:{int(os.path.getmtime(p))}"
    done = state.setdefault("box_from", {})
    try:
        import gamebox3d
        from PIL import Image
    except Exception as e:
        out, need = {}, []
        for pid, art in covers.items():
            box = os.path.join(IMAGES, f"{pid}-box3d.png")
            if os.path.exists(box) and state.get("box3d_version") == BOX_VERSION and done.get(pid) == sig(art):
                out[pid] = box
            else:
                if os.path.exists(box):
                    out[pid] = box   # kept until the app has drawn the new one
                need.append({"id": pid, "title": info[pid]["title"], "cover": art, "url": "", "out": box})
                done[pid] = sig(art)
        if need:
            emit(warning=f"no Pillow here ({e}): the app draws the 3D game boxes", need_boxes=need)
        state["box3d_version"] = BOX_VERSION
        return out
    if shutil.disk_usage(ROMS).free // (1024 * 1024) < 200:
        emit(warning="3D game boxes skipped: less than 200 MB free")
        return {}
    try:
        logo = Image.open(os.path.join(FILES, "luna-icon.png")).convert("RGBA")
    except Exception:
        logo = Image.new("RGBA", (8, 8), (0, 0, 0, 0))
    redo = state.get("box3d_version") != gamebox3d.VERSION
    out, n = {}, 0
    for pid, art in covers.items():
        n += 1
        box = os.path.join(IMAGES, f"{pid}-box3d.png")
        if os.path.exists(box) and not redo and done.get(pid) == sig(art):
            out[pid] = box
        else:
            try:
                im = Image.open(art)
                im.load()
                img = gamebox3d.make(im, info[pid]["title"], logo)
                tmp = box + ".tmp.png"
                img.save(tmp, optimize=True)
                os.replace(tmp, box)
                out[pid] = box
                done[pid] = sig(art)
            except Exception as err:
                emit(warning=f"3D box for {info[pid]['title']}: {err}")
        if n % 10 == 0 or n == len(covers):
            emit(stage="boxes", done=n, total=len(covers))
    for pid in list(done):
        if pid not in covers:
            del done[pid]
    state["box3d_version"] = gamebox3d.VERSION
    return out


def list_games(info, got, state, boxes=None):
    """The games' entries in gamelist.xml (and their small files), with the pictures in got."""
    # the games no longer listed go (only ones this script made)
    gone = set(remove_ours(state, keep_ids=set(info)))
    root = load_gamelist()
    old = {}
    for g in list(root.findall("game")):
        p = g.findtext("path") or ""
        if p in gone or any(p == v.get("file") for v in state["games"].values()):
            old[p] = g
            root.remove(g)
        elif p in OWN:
            pin_first(g)

    used = {os.path.basename(v.get("file", "")) for v in state["games"].values()}
    for pid in sorted(info, key=lambda i: info[i]["title"].lower()):
        d = info[pid]
        prev = state["games"].get(pid, {})
        fname = os.path.basename(prev.get("file", "")) or safe_name(d["title"]) + ".luna"
        if not prev and (fname in used or os.path.exists(os.path.join(ROMS, fname))):
            fname = f"{safe_name(d['title'])} ({pid}).luna"
        used.add(fname)
        with open(os.path.join(ROMS, fname), "w", encoding="utf-8") as f:
            f.write(pid + "\n")
        rel = "./" + fname
        g = ET.SubElement(root, "game")
        sub(g, "path", rel)
        sub(g, "name", d["title"])
        sub(g, "desc", d["desc"][:2000])
        pics = {}
        for kind in ("image", "fanart"):
            p = got.get(os.path.join(IMAGES, f"{pid}-{kind}"))
            if p:
                pics[kind] = "./images/" + os.path.basename(p)
        if boxes and boxes.get(pid):
            pics["box3d"] = "./images/" + os.path.basename(boxes[pid])
        sub(g, "image", pics.get("box3d") or pics.get("image"))
        sub(g, "thumbnail", pics.get("image"))
        sub(g, "fanart", pics.get("fanart"))
        before = old.get(rel)
        for t in KEEP_TAGS:
            v = before.findtext(t) if before is not None else None
            if v:
                sub(g, t, v)
        state["games"][pid] = {"file": rel, "title": d["title"], "slug": d.get("slug", ""), "images": list(pics.values())}
    write_gamelist(root)


def apply_played(path):
    """Games played from the app's dashboard (not launched by EmulationStation,
    which counts its own): their play count, last played and play time in
    EmulationStation's list. path: JSON {store ID: {"n": times, "secs": seconds,
    "last": "YYYYMMDDTHHMMSS"}}, written by the app; removed once done."""
    played = read_json(path, {})
    state = read_json(STATE, {})
    files = {i: (g or {}).get("file") for i, g in (state.get("games") or {}).items()}
    if not played or not os.path.exists(GAMELIST):
        return 0
    root = load_gamelist()
    by_path = {(g.findtext("path") or ""): g for g in root.findall("game")}
    done = []
    for gid, p in played.items():
        f = files.get(gid.upper())
        g = by_path.get(f) if f else None
        if g is None:
            continue
        def num(tag):
            try:
                return int(g.findtext(tag) or 0)
            except ValueError:
                return 0
        for tag, val in (("playcount", num("playcount") + int(p.get("n", 0))), ("gametime", num("gametime") + int(p.get("secs", 0)))):
            e = g.find(tag)
            if e is None:
                e = ET.SubElement(g, tag)
            e.text = str(val)
        if p.get("last"):
            e = g.find("lastplayed")
            if e is None:
                e = ET.SubElement(g, "lastplayed")
            e.text = p["last"]
        done.append(g.findtext("name") or gid)
    if done:
        write_gamelist(root)
        log(f"played from the app, counted in EmulationStation's list: {', '.join(done)}")
        reload_es()
    try:
        os.remove(path)
    except OSError:
        pass
    return 0


def main():
    args = sys.argv[1:]
    if args and args[0] == "played" and len(args) > 1:
        time.sleep(float(os.environ.get("LUNA_PLAYED_WAIT", "6")))   # after EmulationStation has saved its own list
        return apply_played(args[1])
    mode = args[0] if args and args[0] in ("all", "picked", "off") else read_json(CONFIG, {}).get("game_list", "off")
    if mode not in ("all", "picked", "off"):
        mode = "off"
    site = site_of(args)
    state = read_json(STATE, {})
    state.setdefault("games", {})
    os.makedirs(IMAGES, exist_ok=True)

    if mode == "off":
        gone = set(remove_ours(state))
        set_launchsingle(True, state)
        root = load_gamelist(with_settings=not single_launched())
        # Off: just the app itself (and its settings) in the list. Every other entry goes, and every
        # other game file in the folder (EmulationStation would list it again)
        for g in list(root.findall("game")):
            if (g.findtext("path") or "") not in OWN:
                root.remove(g)
        for f in os.listdir(ROMS):
            if f.lower().endswith(".luna") and "./" + f not in OWN:
                try:
                    os.remove(os.path.join(ROMS, f))
                except OSError as err:
                    emit(warning=f"couldn't delete {f} ({err})")
        write_gamelist(root)
        swept = sweep_pictures()
        if swept:
            emit(warning=f"deleted {swept} downloaded pictures")
        state.update(mode="off", count=0, synced=time.time())
        state.pop("details", None)
        write_atomic(STATE, json.dumps(state, indent=2) + "\n")
        open(CHANGED, "w").write("off\n")
        emit(done=True, mode="off", count=0)
        return 0

    emit(stage="list")
    games = sitemap_games(site) if mode == "all" else picked_games()
    if mode == "all" and not games:
        raise RuntimeError(f"Luna's list of games ({site}) came back empty")
    emit(stage="details", total=len(games))
    info = details(games, site, state, keep_missing=(mode == "picked"))
    if games and not any(d.get("t") for d in info.values()):
        raise RuntimeError(f"Luna's game pages ({site}) didn't answer")

    # the games straight away, with the pictures already here (the pictures take
    # a while; this way the list is there even if that's cut short)
    def have(base):
        for e in (".jpg", ".png", ".webp"):
            if os.path.exists(base + e):
                return base + e
        return ""
    now = {}
    for pid in info:
        for kind in ("image", "fanart"):
            b = os.path.join(IMAGES, f"{pid}-{kind}")
            now[b] = have(b)
    # 3D boxes already drawn stay in the list meanwhile
    boxes_now = {}
    if read_json(CONFIG, {}).get("game_list_3d", False):
        boxes_now = {pid: os.path.join(IMAGES, f"{pid}-box3d.png") for pid in info
                     if os.path.exists(os.path.join(IMAGES, f"{pid}-box3d.png"))}
    list_games(info, now, state, boxes_now)
    set_launchsingle(False, state)
    state.update(mode=mode, count=len(info), site=site)
    write_atomic(STATE, json.dumps(state, indent=2) + "\n")
    open(CHANGED, "w").write(mode + "\n")
    emit(stage="listed", count=len(info))
    reload_es()

    # pictures: the game's picture from its page, as the list picture and a
    # bigger copy as the background (skipped when space is short)
    free_mb = shutil.disk_usage(ROMS).free // (1024 * 1024)
    jobs = []
    for pid, d in info.items():
        if free_mb > 100 and d.get("art"):
            jobs.append((sized(d["art"], 640), os.path.join(IMAGES, f"{pid}-image"), d["art"]))
        if free_mb > 400 and d.get("art"):
            jobs.append((sized(d["art"], 1280), os.path.join(IMAGES, f"{pid}-fanart"), d["art"]))
    got = {}
    with ThreadPoolExecutor(8) as pool:
        for n, (job, path) in enumerate(zip(jobs, pool.map(fetch_image, jobs)), 1):
            got[job[1]] = path
            if n % 25 == 0 or n == len(jobs):
                emit(stage="art", done=n, total=len(jobs))

    want3d = bool(read_json(CONFIG, {}).get("game_list_3d", False))
    boxes = make_boxes(info, got, state) if want3d else {}
    list_games(info, got, state, boxes)
    # pictures of games no longer listed, 3D boxes no longer used (and covers
    # from older versions)
    for f in os.listdir(IMAGES):
        if (f.endswith("-box3d.png") and f[:10] not in boxes) or f.endswith("-cover.jpg") or "-poster." in f or "-marquee." in f:
            m = OUR_PICTURE.match(f)
            if m:
                try:
                    os.remove(os.path.join(IMAGES, f))
                except OSError:
                    pass
    sweep_pictures(keep_ids=set(info))
    set_launchsingle(False, state)
    state.update(mode=mode, count=len(info), synced=time.time(), site=site, box3d=bool(boxes))
    if not want3d:
        state.pop("box3d_version", None)
        state.pop("box_from", None)
    write_atomic(STATE, json.dumps(state, indent=2) + "\n")
    open(CHANGED, "w").write(mode + "\n")
    emit(done=True, mode=mode, count=len(info))
    reload_es()
    return 0


def locked():
    """One run at a time: a second one waits for the first (which may be
    carrying on after the app closed), then goes, quickly, with its pictures."""
    try:
        lock = open(LOCK, "w")
    except OSError:
        return None
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        emit(stage="waiting")
        fcntl.flock(lock, fcntl.LOCK_EX)
    return lock


if __name__ == "__main__":
    try:
        _lock = locked()
        sys.exit(main())
    except Exception as e:
        emit(error=str(e))
        sys.exit(1)
