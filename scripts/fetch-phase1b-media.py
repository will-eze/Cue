#!/usr/bin/env python3
"""
Phase 1b — curated worship media library fetcher.

Pulls 16:9 / 1080p motion backgrounds from two license-clean, no-attribution,
keyless sources:
  - Coverr  (JSON API, precise aspect_ratio + is_vertical filtering) -> primary
  - Mixkit  (tag pages serve direct 1080p mp4 links)                 -> secondary

Every downloaded file is dimension-verified (pure-Python mp4 tkhd parse, no
ffmpeg) and discarded unless it is landscape ~16:9. Idempotent: existing files
are skipped, so the script can be re-run / resumed.

Usage:
  python3 scripts/fetch-phase1b-media.py            # full run
  python3 scripts/fetch-phase1b-media.py --pilot    # a few terms only
  python3 scripts/fetch-phase1b-media.py --coverr-per-term 2 --mixkit-per-tag 3
"""
import argparse, json, os, re, struct, sys, time, urllib.request, urllib.parse, urllib.error
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                    "resources", "media", "Worship Backgrounds")
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
# Pexels: a real free key (env) is preferred; the API also accepts any non-empty
# token for read search, content is Pexels-licensed (free, no attribution).
PEXELS_KEY = os.environ.get("PEXELS_API_KEY", "cue-phase1b-fetch")
PIXABAY_KEY = os.environ.get("PIXABAY_API_KEY", "")     # required (free): pixabay.com/api/docs
UNSPLASH_KEY = os.environ.get("UNSPLASH_ACCESS_KEY", "")  # required (free): unsplash.com/oauth/applications

# ---- search term -> category folder -------------------------------------
COVERR_TERMS = {
    # Reflective Worship
    "sunrise through clouds": "Clouds",
    "golden light forest": "Forests",
    "morning mist mountains": "Mountains",
    "peaceful lake sunrise": "Oceans",
    "light rays through trees": "Forests",
    "calm ocean horizon": "Oceans",
    "mountain valley fog": "Mountains",
    "quiet wilderness landscape": "Mountains",
    # Powerful Praise
    "aerial mountain range": "Mountains",
    "ocean waves drone": "Oceans",
    "dramatic clouds timelapse": "Clouds",
    "waterfall cinematic": "Forests",
    "storm clouds over mountains": "Clouds",
    "vast landscape drone": "Mountains",
    "sunrise above clouds": "Clouds",
    # Prayer & Communion
    "candle light bokeh": "Communion",
    "warm light abstract": "Abstract",
    "slow moving smoke": "Abstract",
    "dark atmospheric background": "Abstract",
    "soft golden particles": "Abstract",
    "gentle water ripples": "Abstract",
    "shallow depth of field lights": "Prayer",
    # Scripture Reading
    "parchment texture": "Scripture",
    "dark mountain landscape": "Scripture",
    "desert sunrise": "Scripture",
    "ancient olive trees": "Scripture",
    "wilderness path": "Scripture",
    "rolling hills sunset": "Scripture",
    "stars over mountains": "Scripture",
    # Contemporary Worship
    "cinematic aerial landscape": "Mountains",
    "modern abstract motion": "Abstract",
    "slow light leaks": "Abstract",
    "ambient particles": "Abstract",
    "atmospheric clouds": "Clouds",
    "cinematic nature footage": "Forests",
    "minimal dark background": "Abstract",
    # General High-Quality
    "cinematic landscape": "Mountains",
    "atmospheric nature": "Forests",
    "moody mountains": "Mountains",
    "aerial drone nature": "Mountains",
    "clouds timelapse": "Clouds",
    "ocean drone": "Oceans",
    "forest sunlight": "Forests",
    "worship background": "Abstract",
    "cinematic sky": "Clouds",
    "abstract light particles": "Abstract",
    "ambient nature": "Forests",
    "majestic mountains": "Mountains",
    "peaceful scenery": "Mountains",
    "slow motion nature": "Forests",
    "dark landscape": "Mountains",
    # Celebration & Seasonal (folders exist but RTF gave no terms)
    "confetti celebration": "Celebration",
    "fireworks night sky": "Celebration",
    "concert stage lights": "Celebration",
    "worship hands raised": "Celebration",
    "autumn leaves falling": "Seasonal",
    "winter snow falling": "Seasonal",
    "christmas lights bokeh": "Seasonal",
    "spring blossom": "Seasonal",
    # Top-up: thin categories (Prayer / Communion / Celebration / Abstract)
    "praying hands": "Prayer",
    "person praying silhouette": "Prayer",
    "kneeling in prayer": "Prayer",
    "open bible pages": "Communion",
    "bread and wine": "Communion",
    "cross silhouette sunset": "Communion",
    "crowd at concert": "Celebration",
    "celebration fireworks display": "Celebration",
    "cheering crowd hands": "Celebration",
    "colorful ink in water": "Abstract",
    "glowing particles dark background": "Abstract",
    "light streaks motion": "Abstract",
}

# Pexels: the keyless path only accepts SINGLE-WORD queries (multi-word -> 401),
# so drive it from single keywords mapped to categories (a real key lifts this).
PEXELS_TERMS = {
    "mountains": "Mountains", "valley": "Mountains", "hills": "Mountains",
    "cliff": "Mountains", "fjord": "Mountains", "alps": "Mountains",
    "ocean": "Oceans", "sea": "Oceans", "waves": "Oceans", "coast": "Oceans",
    "lake": "Oceans", "beach": "Oceans",
    "forest": "Forests", "woods": "Forests", "waterfall": "Forests",
    "jungle": "Forests", "trees": "Forests",
    "clouds": "Clouds", "sky": "Clouds", "sunrise": "Clouds",
    "sunset": "Clouds", "storm": "Clouds",
    "smoke": "Abstract", "particles": "Abstract", "bokeh": "Abstract",
    "abstract": "Abstract", "ink": "Abstract", "gradient": "Abstract",
    "candle": "Communion", "candles": "Communion",
    "desert": "Scripture", "stars": "Scripture", "wilderness": "Scripture",
    "galaxy": "Scripture",
    "prayer": "Prayer", "worship": "Prayer", "praying": "Prayer",
    "fireworks": "Celebration", "confetti": "Celebration", "concert": "Celebration",
    "snow": "Seasonal", "autumn": "Seasonal", "winter": "Seasonal",
    "christmas": "Seasonal", "flowers": "Seasonal",
}

# Mixkit single-word/hyphen tag pages -> category (for extra variety)
MIXKIT_TAGS = {
    "mountains": "Mountains", "mountain": "Mountains", "fog": "Mountains",
    "ocean": "Oceans", "sea": "Oceans", "waves": "Oceans", "beach": "Oceans",
    "forest": "Forests", "trees": "Forests", "waterfall": "Forests",
    "clouds": "Clouds", "sky": "Clouds", "sunset": "Clouds", "sunrise": "Clouds",
    "smoke": "Abstract", "particles": "Abstract", "bokeh": "Abstract",
    "abstract": "Abstract", "lights": "Abstract",
    "candle": "Communion", "desert": "Scripture", "stars": "Scripture",
    "snow": "Seasonal", "autumn": "Seasonal", "fireworks": "Celebration",
}

# ---- mp4 inspection (no ffmpeg) ------------------------------------------
MIN_MBPS = 2.5   # 1080p below this shows visible compression artifacts (grainy)

def mp4_dims(path):
    """Robust: scan the WHOLE file for a valid tkhd box (a 2 MB window hits a
    false 'tkhd' byte-match inside mdat on non-faststart clips)."""
    try:
        with open(path, "rb") as f:
            data = f.read()
    except Exception:
        return None
    i = 0
    while True:
        i = data.find(b"tkhd", i)
        if i < 0:
            return None
        bs = i - 4
        if bs >= 0:
            size = struct.unpack(">I", data[bs:bs + 4])[0]
            if 84 <= size < 200 and bs + size <= len(data):
                w = struct.unpack(">I", data[bs + size - 8:bs + size - 4])[0] >> 16
                h = struct.unpack(">I", data[bs + size - 4:bs + size])[0] >> 16
                if w and h:
                    return (w, h)
        i += 4

def mp4_duration(path):
    try:
        with open(path, "rb") as f:
            data = f.read()
        j = data.find(b"mvhd")
        if j < 0:
            return None
        ver = data[j + 4]
        if ver == 0:
            ts = struct.unpack(">I", data[j + 16:j + 20])[0]
            d = struct.unpack(">I", data[j + 20:j + 24])[0]
        else:
            ts = struct.unpack(">I", data[j + 24:j + 28])[0]
            d = struct.unpack(">Q", data[j + 28:j + 36])[0]
        return d / ts if ts else None
    except Exception:
        return None

def is_16x9(dims):
    if not dims:
        return False
    w, h = dims
    if w < 1280 or h < 720 or w <= h:
        return False
    return 1.74 <= (w / h) <= 1.81

def video_ok(path):
    """16:9 AND >=1080p AND not grainy (bitrate). Returns (ok, reason)."""
    d = mp4_dims(path)
    if not is_16x9(d):
        return False, f"dims={d}"
    if d[1] < 1080:
        return False, f"{d[0]}x{d[1]}<1080p"
    dur = mp4_duration(path)
    if dur:
        mbps = os.path.getsize(path) * 8 / dur / 1e6
        if mbps < MIN_MBPS:
            return False, f"{mbps:.1f}Mbps grainy"
    return True, None

# ---- http helpers --------------------------------------------------------
def http_get(url, accept=None):
    req = urllib.request.Request(url, headers={"User-Agent": UA,
                                               **({"Accept": accept} if accept else {})})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()

def download(url, dest):
    tmp = dest + ".part"
    last = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=180) as r, open(tmp, "wb") as f:
                while True:
                    chunk = r.read(1 << 16)
                    if not chunk:
                        break
                    f.write(chunk)
            os.rename(tmp, dest)
            return
        except Exception as e:
            last = e
            try: os.remove(tmp)
            except OSError: pass
            time.sleep(1.5 * (attempt + 1))
    raise last

def slugify(s):
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return s[:60]

# ---- sources -------------------------------------------------------------
seen = set()        # global dedup keys
stats = {"coverr": 0, "mixkit": 0, "pexels": 0, "pixabay": 0, "unsplash": 0,
         "skipped": 0, "rejected": 0}

JOBS = []  # (url, dest, source, name, category, verify)

def enqueue(url, category, name, source, verify=True):
    """Register a download. Counts existing files toward per-term limits so
    re-runs are idempotent (won't keep growing). Returns True if it 'counts'."""
    dest = os.path.join(ROOT, category, name)
    if os.path.exists(dest):
        stats["skipped"] += 1
        return True
    JOBS.append((url, dest, source, name, category, verify))
    return True

def run_jobs(workers=8):
    """Download all queued jobs concurrently; verify mp4 dims (drop non-16:9)."""
    if not JOBS:
        return
    print(f"\n-- downloading {len(JOBS)} files ({workers} parallel) --")
    def work(job):
        url, dest, source, name, category, verify = job
        try:
            download(url, dest)
        except Exception as e:
            return ("fail", category, name, str(e))
        if verify:
            ok, reason = video_ok(dest)
            if not ok:
                try: os.remove(dest)
                except OSError: pass
                return ("rejected", category, name, reason)
        return ("ok", source, category, name)
    with ThreadPoolExecutor(max_workers=workers) as ex:
        for status, a, b, c in ex.map(work, list(JOBS)):
            if status == "ok":
                stats[a] += 1
                print(f"    + {b}/{c}")
            elif status == "rejected":
                stats["rejected"] += 1
                print(f"    x rejected {a}/{b} dims={c}")
            else:
                print(f"    ! failed {a}/{b}: {c}")
    JOBS.clear()

def fetch_coverr(term, category, per_term):
    q = urllib.parse.quote(term)
    try:
        raw = http_get(f"https://coverr.co/api/videos?query={q}&page_size=20",
                       accept="application/json")
        hits = json.loads(raw).get("hits", [])
    except Exception as e:
        print(f"  coverr query failed '{term}': {e}")
        return
    got = 0
    for h in hits:
        if got >= per_term:
            break
        if h.get("aspect_ratio") != "16:9" or h.get("is_vertical") or h.get("is_premium"):
            continue
        bf = h.get("base_filename")
        if not bf or bf in seen:
            continue
        seen.add(bf)
        url = f"https://cdn.coverr.co/videos/{bf}/1080p.mp4"
        name = f"coverr-{slugify(h.get('slug') or bf)}.mp4"
        enqueue(url, category, name, "coverr")
        got += 1

def fetch_pexels(term, category, per_term):
    q = urllib.parse.quote(term)
    url = (f"https://api.pexels.com/videos/search?query={q}"
           f"&per_page=20&orientation=landscape&size=large")  # large -> real 1080p+ renditions
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Authorization": PEXELS_KEY})
    videos = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                videos = json.loads(r.read()).get("videos", [])
            break
        except urllib.error.HTTPError as e:
            # 401 on the keyless path is deterministic per-query (cache miss) -> don't retry
            if e.code == 401:
                print(f"  pexels 401 (needs real key) '{term}'")
                return
            if attempt == 2:
                print(f"  pexels query failed '{term}': {e}")
                return
            time.sleep(1.5 * (attempt + 1))
        except Exception as e:
            if attempt == 2:
                print(f"  pexels query failed '{term}': {e}")
                return
            time.sleep(1.5 * (attempt + 1))
    if not videos:
        return
    got = 0
    for v in videos:
        if got >= per_term:
            break
        w, h = v.get("width", 0), v.get("height", 0)
        if not h or w <= h or not (1.74 <= w / h <= 1.81):  # landscape 16:9 only
            continue
        vid = f"pexels-{v.get('id')}"
        if vid in seen:
            continue
        # require a true >=1080p landscape rendition; prefer exactly 1080p (smallest >=1080)
        files = [f for f in v.get("video_files", [])
                 if f.get("width") and f.get("height") and f["width"] > f["height"]
                 and f["height"] >= 1080]
        if not files:
            continue  # no 1080p source -> skip (avoids grainy 720p)
        best = min(files, key=lambda f: f["height"])
        seen.add(vid)
        enqueue(best["link"], category, f"{vid}.mp4", "pexels")
        got += 1

def fetch_pixabay(term, category, per_term):
    if not PIXABAY_KEY:
        return
    q = urllib.parse.quote(term)
    url = (f"https://pixabay.com/api/videos/?key={PIXABAY_KEY}&q={q}"
           f"&per_page=12&video_type=film")
    try:
        hits = json.loads(http_get(url, accept="application/json")).get("hits", [])
    except Exception as e:
        print(f"  pixabay query failed '{term}': {e}")
        return
    got = 0
    for h in hits:
        if got >= per_term:
            break
        vid = f"pixabay-{h.get('id')}"
        if vid in seen:
            continue
        streams = h.get("videos", {})
        # require >=1080p landscape 16:9; prefer exactly 1080p
        cands = [s for s in streams.values()
                 if s.get("width") and s.get("height") and s["width"] > s["height"]
                 and 1.74 <= s["width"] / s["height"] <= 1.81 and s["height"] >= 1080]
        if not cands:
            continue
        best = min(cands, key=lambda s: s["height"])
        seen.add(vid)
        enqueue(best["url"], category, f"{vid}.mp4", "pixabay")
        got += 1

def fetch_unsplash(term, category, per_term):
    if not UNSPLASH_KEY:
        return
    q = urllib.parse.quote(term)
    url = (f"https://api.unsplash.com/search/photos?query={q}&per_page=10"
           f"&orientation=landscape&client_id={UNSPLASH_KEY}")
    try:
        results = json.loads(http_get(url, accept="application/json")).get("results", [])
    except Exception as e:
        print(f"  unsplash query failed '{term}': {e}")
        return
    got = 0
    for p in results:
        if got >= per_term:
            break
        pid = f"unsplash-{p.get('id')}"
        if pid in seen:
            continue
        raw = (p.get("urls") or {}).get("raw")
        if not raw:
            continue
        # force an exact 1920x1080 (16:9) crop via Unsplash's imgix params
        sep = "&" if "?" in raw else "?"
        link = f"{raw}{sep}w=1920&h=1080&fit=crop&crop=entropy&fm=jpg&q=82"
        seen.add(pid)
        enqueue(link, category, f"{pid}.jpg", "unsplash", verify=False)
        got += 1

def fetch_mixkit(tag, category, per_tag):
    try:
        html = http_get(f"https://mixkit.co/free-stock-video/{tag}/").decode("utf-8", "ignore")
    except Exception as e:
        print(f"  mixkit tag failed '{tag}': {e}")
        return
    urls = []
    for m in re.findall(r'https://assets\.mixkit\.co/[^"\']+-1080\.mp4', html):
        if m not in urls:
            urls.append(m)
    got = 0
    for url in urls:
        if got >= per_tag:
            break
        # two URL forms: /videos/<id>/<id>-1080.mp4  and
        # /active_storage/video_items/<id>/<ts>/<id>-video-1080.mp4
        vid = re.search(r"/videos/(\d+)/", url) or re.search(r"/video_items/(\d+)/", url)
        key = "mixkit-" + (vid.group(1) if vid else slugify(url))
        if key in seen:
            continue
        seen.add(key)
        enqueue(url, category, f"{key}.mp4", "mixkit")
        got += 1

# ---- main ----------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pilot", action="store_true")
    ap.add_argument("--coverr-per-term", type=int, default=2)
    ap.add_argument("--mixkit-per-tag", type=int, default=3)
    ap.add_argument("--no-mixkit", action="store_true")
    ap.add_argument("--no-coverr", action="store_true")
    ap.add_argument("--no-pexels", action="store_true")
    ap.add_argument("--no-pixabay", action="store_true")
    ap.add_argument("--no-unsplash", action="store_true")
    ap.add_argument("--pexels-per-term", type=int, default=2)
    ap.add_argument("--pixabay-per-term", type=int, default=2)
    ap.add_argument("--unsplash-per-term", type=int, default=1)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--tags", help="comma list: only these Mixkit tags")
    args = ap.parse_args()

    terms = list(COVERR_TERMS.items())
    tags = list(MIXKIT_TAGS.items())
    if args.pilot:
        terms = terms[:4] + [("candle light bokeh", "Communion")]
        tags = tags[:3]
    if args.tags:
        only = {t.strip() for t in args.tags.split(",")}
        tags = [(t, c) for t, c in tags if t in only]

    if not args.no_coverr:
        print(f"== Coverr: {len(terms)} terms, up to {args.coverr_per_term}/term ==")
        for term, cat in terms:
            print(f"  [{cat}] {term}")
            fetch_coverr(term, cat, args.coverr_per_term)

    if not args.no_pexels:
        # real key handles multi-word phrases -> richer term list; fake key needs keywords
        real_pexels = bool(os.environ.get("PEXELS_API_KEY"))
        pterms = list(COVERR_TERMS.items()) if real_pexels else list(PEXELS_TERMS.items())
        if args.pilot:
            pterms = pterms[:5]
        kind = "terms" if real_pexels else "keywords"
        print(f"\n== Pexels: {len(pterms)} {kind}, up to {args.pexels_per_term} each ==")
        for term, cat in pterms:
            print(f"  [{cat}] {term}")
            fetch_pexels(term, cat, args.pexels_per_term)

    if not args.no_pixabay and PIXABAY_KEY:
        print(f"\n== Pixabay: {len(terms)} terms, up to {args.pixabay_per_term}/term ==")
        for term, cat in terms:
            print(f"  [{cat}] {term}")
            fetch_pixabay(term, cat, args.pixabay_per_term)
    elif not args.no_pixabay:
        print("\n== Pixabay: skipped (set PIXABAY_API_KEY) ==")

    if not args.no_unsplash and UNSPLASH_KEY:
        print(f"\n== Unsplash (photos): {len(terms)} terms, up to {args.unsplash_per_term}/term ==")
        for term, cat in terms:
            print(f"  [{cat}] {term}")
            fetch_unsplash(term, cat, args.unsplash_per_term)
    elif not args.no_unsplash:
        print("\n== Unsplash: skipped (set UNSPLASH_ACCESS_KEY) ==")

    if not args.no_mixkit:
        print(f"\n== Mixkit: {len(tags)} tags, up to {args.mixkit_per_tag}/tag ==")
        for tag, cat in tags:
            print(f"  [{cat}] #{tag}")
            fetch_mixkit(tag, cat, args.mixkit_per_tag)

    run_jobs(workers=args.workers)  # parallel download of everything queued

    print(f"\n== Done: coverr={stats['coverr']} mixkit={stats['mixkit']} "
          f"pexels={stats['pexels']} pixabay={stats['pixabay']} unsplash={stats['unsplash']} "
          f"skipped(existing)={stats['skipped']} rejected(non-16:9)={stats['rejected']} ==")

if __name__ == "__main__":
    main()
