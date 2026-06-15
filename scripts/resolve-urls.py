#!/usr/bin/env python3
"""
Phase 1b — resolve each manifest item to its ORIGIN download URL (Option A:
the app streams from each source's CDN on demand; we never rehost).

We didn't store URLs at fetch time, so re-derive them from each item's id/slug:
  - coverr   : search by slug words, match exact slug -> base_filename -> cdn url
  - mixkit   : deterministic assets.mixkit.co/videos/<id>/<id>-1080.mp4
  - pexels   : GET /videos/videos/<id> -> video_files (>=1080p)         [key]
  - pixabay  : GET ?id=<id> -> videos rendition (>=1080p)               [key]
  - unsplash : GET /photos/<id> -> urls.raw + 1920x1080 crop params     [key]

Writes `url` (+ `page`) into every item and a liveness flag. The app ships this
manifest and downloads from `url`; no API key needed to fetch a known file URL.

  PEXELS_API_KEY=.. PIXABAY_API_KEY=.. UNSPLASH_ACCESS_KEY=.. \
  python3 scripts/resolve-urls.py [--sample N] [--download-test]
"""
import argparse, json, os, re, struct, time, urllib.request, urllib.parse, urllib.error
from concurrent.futures import ThreadPoolExecutor

BASE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "resources")
# tracked, shippable deliverable (outside the gitignored resources/media/ working dir)
MANIFEST = os.path.join(BASE, "media-manifest.json")
UA = "Mozilla/5.0"
PEXELS_KEY = os.environ.get("PEXELS_API_KEY", "")
PIXABAY_KEY = os.environ.get("PIXABAY_API_KEY", "")
UNSPLASH_KEY = os.environ.get("UNSPLASH_ACCESS_KEY", "")

def http_json(url, headers=None):
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers=headers or {"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=40) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < 3:   # rate limited -> back off
                time.sleep(2 * (attempt + 1))
                continue
            raise

def live(url):
    """HTTP HEAD-ish: a 2-byte range request; 200/206 => downloadable."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Range": "bytes=0-1"})
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status in (200, 206)
    except Exception:
        return False

def pick_1080(files, wkey="width", hkey="height", urlkey="link"):
    cands = [f for f in files if f.get(wkey) and f.get(hkey)
             and f[wkey] > f[hkey] and f[hkey] >= 1080]
    if not cands:
        return None
    return min(cands, key=lambda f: f[hkey]).get(urlkey)

# ---- per-source resolvers (return (url, page) or (None, reason)) ---------
def r_coverr(fn, _id):
    slug = fn[len("coverr-"):-4]
    words = re.sub(r"-[a-z0-9]{10}$", "", slug).replace("-", " ")
    q = urllib.parse.quote_plus(words)
    try:
        hits = http_json(f"https://coverr.co/api/videos?query={q}&page_size=40",
                         {"User-Agent": UA, "Accept": "application/json"}).get("hits", [])
    except Exception as e:
        return None, f"coverr query err {e}"
    for h in hits:
        if h.get("slug") == slug and h.get("base_filename"):
            bf = h["base_filename"]
            return f"https://cdn.coverr.co/videos/{bf}/1080p.mp4", f"https://coverr.co/videos/{slug}"
    return None, "coverr slug not matched"

def r_mixkit(fn, vid):
    url = f"https://assets.mixkit.co/videos/{vid}/{vid}-1080.mp4"
    return (url, None) if live(url) else (None, "mixkit active_storage form")

def r_pexels(fn, vid):
    if not PEXELS_KEY:
        return None, "no pexels key"
    try:
        d = http_json(f"https://api.pexels.com/videos/videos/{vid}",
                      {"User-Agent": UA, "Authorization": PEXELS_KEY})
    except Exception as e:
        return None, f"pexels err {e}"
    url = pick_1080(d.get("video_files", []))
    return (url, d.get("url")) if url else (None, "pexels no 1080p")

def r_pixabay(fn, vid):
    if not PIXABAY_KEY:
        return None, "no pixabay key"
    try:
        hits = http_json(f"https://pixabay.com/api/videos/?key={PIXABAY_KEY}&id={vid}").get("hits", [])
    except Exception as e:
        return None, f"pixabay err {e}"
    if not hits:
        return None, "pixabay id gone"
    url = pick_1080(list(hits[0].get("videos", {}).values()), urlkey="url")
    return (url, hits[0].get("pageURL")) if url else (None, "pixabay no 1080p")

def r_unsplash(fn, vid):
    if not UNSPLASH_KEY:
        return None, "no unsplash key"
    try:
        d = http_json(f"https://api.unsplash.com/photos/{vid}?client_id={UNSPLASH_KEY}")
    except urllib.error.HTTPError as e:
        return None, f"unsplash {e.code}"
    except Exception as e:
        return None, f"unsplash err {e}"
    raw = (d.get("urls") or {}).get("raw")
    if not raw:
        return None, "unsplash no raw"
    sep = "&" if "?" in raw else "?"
    url = f"{raw}{sep}w=1920&h=1080&fit=crop&crop=entropy&fm=jpg&q=82"
    return url, (d.get("links") or {}).get("html")

RES = {"coverr": r_coverr, "mixkit": r_mixkit, "pexels": r_pexels,
       "pixabay": r_pixabay, "unsplash": r_unsplash}

# ---- mp4/jpeg sanity (for --download-test) -------------------------------
def mp4_dims(p):
    with open(p, "rb") as f: data = f.read()
    i = 0
    while True:
        i = data.find(b"tkhd", i)
        if i < 0: return None
        bs = i - 4
        if bs >= 0:
            sz = struct.unpack(">I", data[bs:bs+4])[0]
            if 84 <= sz < 200 and bs+sz <= len(data):
                w = struct.unpack(">I", data[bs+sz-8:bs+sz-4])[0] >> 16
                h = struct.unpack(">I", data[bs+sz-4:bs+sz])[0] >> 16
                if w and h: return (w, h)
        i += 4

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample", type=int, default=0, help="resolve only N per source")
    ap.add_argument("--download-test", action="store_true", help="fully download resolved samples + verify")
    ap.add_argument("--write", action="store_true", help="write urls back into manifest.json")
    ap.add_argument("--only-missing", action="store_true", help="only resolve items without a url")
    ap.add_argument("--workers", type=int, default=6, help="parallelism (use 1 to avoid Coverr 429)")
    args = ap.parse_args()

    man = json.load(open(MANIFEST))
    items = man["items"]
    if args.sample:
        bysrc, picked = {}, []
        for it in items:
            s = it["source"]; bysrc.setdefault(s, 0)
            if bysrc[s] < args.sample:
                picked.append(it); bysrc[s] += 1
        items = picked

    def work(it):
        if args.only_missing and it.get("url"):
            return it, it["url"], "kept", True
        fn = os.path.basename(it["file"])
        src = it["source"]
        ident = fn[len(src)+1:].rsplit(".", 1)[0]
        url, note = RES[src](fn, ident)
        ok = bool(url) and live(url)
        return it, url, note, ok
    print(f"resolving {len(items)} items...")
    results = []
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        for it, url, note, ok in ex.map(work, items):
            results.append((it, url, ok, note))
            if url:
                it["url"] = url
            elif "url" in it:
                del it["url"]

    # report
    from collections import Counter
    bysrc = Counter(); fails = []
    for it, url, ok, note in results:
        bysrc[it["source"], "ok" if ok else "FAIL"] += 1
        if not ok: fails.append((it["file"], note))
    print("\n=== resolution by source (live-checked) ===")
    srcs = sorted({s for s, _ in bysrc})
    for s in srcs:
        print(f"  {s:9} ok={bysrc[(s,'ok')]:3}  fail={bysrc[(s,'FAIL')]}")
    if fails:
        print(f"\n=== {len(fails)} unresolved/dead ===")
        for f, n in fails[:40]: print(f"  - {f}  ({n})")

    if args.download_test:
        import tempfile
        print("\n=== download-test (fetch fresh from resolved url, verify) ===")
        seen = set()
        for it, url, ok, note in results:
            if not ok or it["source"] in seen: continue
            seen.add(it["source"])
            ext = ".jpg" if it["kind"] == "photo" else ".mp4"
            tmp = tempfile.mktemp(suffix=ext)
            try:
                req = urllib.request.Request(url, headers={"User-Agent": UA})
                with urllib.request.urlopen(req, timeout=120) as r, open(tmp, "wb") as f:
                    f.write(r.read())
                if ext == ".mp4":
                    d = mp4_dims(tmp); info = f"{d[0]}x{d[1]}" if d else "??"
                else:
                    info = f"{os.path.getsize(tmp)//1024}KB jpg"
                print(f"  ✓ {it['source']:9} {os.path.getsize(tmp)//1024:>6}KB  {info}  {it['file']}")
            except Exception as e:
                print(f"  ✗ {it['source']:9} download failed: {e}")
            finally:
                if os.path.exists(tmp): os.remove(tmp)

    if args.write and not args.sample:
        man["resolved"] = str(__import__("datetime").date.today())
        man["distribution"] = "Option A: app downloads each item from its origin CDN `url` on demand"
        json.dump(man, open(MANIFEST, "w"), indent=2)
        print("\nwrote urls into manifest.json")
    elif args.write:
        print("\n(--write ignored with --sample; run full to persist)")

if __name__ == "__main__":
    main()
