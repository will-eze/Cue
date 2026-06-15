#!/usr/bin/env python3
"""
Phase 1b — flatten the media pool + build a tagged manifest.

The folder taxonomy mixed two axes (subject: Mountains/Oceans/... vs use:
Communion/Scripture/...), so items spanning both always looked misfiled.
This flattens everything into one pool and moves categorization into
`manifest.json` as multi-tags pulled from each source's REAL keywords, so a
clip surfaces however an operator searches (e.g. candle -> candle, bokeh, dark,
communion).

Tags per item = source keywords  ∪  scene buckets  ∪  mood/use tags
                 ∪ the original folder name (it encoded the fetch intent).

Re-fetches metadata by id: Pexels/Pixabay/Unsplash via their APIs (keys from
env); Coverr from its descriptive filename slug; Mixkit from the folder only.
Run:  PEXELS_API_KEY=.. PIXABAY_API_KEY=.. UNSPLASH_ACCESS_KEY=.. \
      python3 scripts/organize-media.py
"""
import json, os, re, struct, time, urllib.request, urllib.parse
from datetime import date
from concurrent.futures import ThreadPoolExecutor

BASE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "resources", "media")
SRC_ROOT = os.path.join(BASE, "Worship Backgrounds")
POOL = os.path.join(BASE, "library")
UA = "Mozilla/5.0"
PEXELS_KEY = os.environ.get("PEXELS_API_KEY", "")
PIXABAY_KEY = os.environ.get("PIXABAY_API_KEY", "")
UNSPLASH_KEY = os.environ.get("UNSPLASH_ACCESS_KEY", "")

STOP = set("the a an of in on with and to at is for from into over under by this that "
           "near above below your you new free hd video footage stock clip background".split())

SCENE = {  # keyword fragment -> canonical scene tag
    "mountains": ["mountain", "peak", "hill", "valley", "alps", "fjord", "cliff", "volcano", "summit"],
    "water": ["ocean", "sea", "wave", "beach", "coast", "water", "lake", "river", "waterfall", "shore"],
    "forest": ["forest", "tree", "wood", "jungle", "leaf", "leaves", "foliage", "branch"],
    "sky": ["cloud", "sky", "sunrise", "sunset", "sun", "storm", "horizon", "dawn", "dusk"],
    "snow": ["snow", "winter", "ice", "frost", "frozen"],
    "abstract": ["candle", "bokeh", "light", "glow", "particle", "smoke", "abstract", "blur", "gradient", "ink", "neon"],
    "night": ["star", "galaxy", "night", "milky", "cosmos", "astro"],
    "desert": ["desert", "sand", "dune", "arid"],
}
MOOD = {  # keyword fragment -> mood/use tag
    "communion": ["candle", "cross", "bread", "wine", "chalice", "altar"],
    "prayer": ["pray", "hands", "worship", "kneel", "silhouette", "faith"],
    "celebration": ["firework", "confetti", "concert", "crowd", "party", "celebrat", "festive"],
    "scripture": ["desert", "wilderness", "star", "path", "ancient", "scroll", "parchment", "olive", "stone"],
    "seasonal": ["snow", "autumn", "winter", "christmas", "leaves", "blossom", "spring", "fall", "holiday"],
}

def clean(words):
    out = set()
    for w in words:
        w = re.sub(r"[^a-z0-9]", "", w.lower())
        if len(w) < 3 or w in STOP:
            continue
        # drop ids/junk: pure digits, or mixed letters+digits (e.g. coverr 'witjlip4yv')
        if w.isdigit() or (any(c.isdigit() for c in w) and any(c.isalpha() for c in w)):
            continue
        out.add(w)
    return out

def derive(raw_words, category):
    tags = clean(raw_words)
    base = " ".join(tags)
    for scene, frags in SCENE.items():
        if any(fr in base for fr in frags):
            tags.add(scene)
    for mood, frags in MOOD.items():
        if any(fr in base for fr in frags):
            tags.add(mood)
    tags.add(category.lower())  # original folder encoded fetch intent
    return sorted(tags)

# ---- per-source keyword fetch -------------------------------------------
def get(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.loads(r.read())

def kw_coverr(fid, fn):  # slug words from filename: coverr-<slug>.mp4
    slug = fn[len("coverr-"):-4]
    return re.split(r"-", slug)

def kw_pexels(fid, fn):
    if not PEXELS_KEY:
        return []
    try:
        d = get(f"https://api.pexels.com/videos/videos/{fid}",
                {"User-Agent": UA, "Authorization": PEXELS_KEY})
    except Exception:
        return []
    words = list(d.get("tags") or [])
    m = re.search(r"/video/([a-z0-9-]+?)-\d+/?$", d.get("url", ""))
    if m:
        words += m.group(1).split("-")
    return words

def kw_pixabay(fid, fn):
    if not PIXABAY_KEY:
        return []
    try:
        d = get(f"https://pixabay.com/api/videos/?key={PIXABAY_KEY}&id={fid}")
        hits = d.get("hits", [])
        return (hits[0].get("tags", "").split(",") if hits else [])
    except Exception:
        return []

def kw_unsplash(fid, fn):
    if not UNSPLASH_KEY:
        return []
    try:
        d = get(f"https://api.unsplash.com/photos/{fid}?client_id={UNSPLASH_KEY}")
        words = [t.get("title", "") for t in (d.get("tags") or [])]
        words += (d.get("alt_description") or "").split()
        return words
    except Exception:
        return []

FETCH = {"coverr": kw_coverr, "pexels": kw_pexels, "pixabay": kw_pixabay,
         "unsplash": kw_unsplash, "mixkit": lambda fid, fn: []}

# ---- mp4 dims/duration ---------------------------------------------------
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

def mp4_dur(p):
    with open(p, "rb") as f: data = f.read()
    j = data.find(b"mvhd")
    if j < 0: return None
    ver = data[j+4]
    ts, d = (struct.unpack(">I", data[j+16:j+20])[0], struct.unpack(">I", data[j+20:j+24])[0]) if ver == 0 \
        else (struct.unpack(">I", data[j+24:j+28])[0], struct.unpack(">Q", data[j+28:j+36])[0])
    return d/ts if ts else None

# ---- main ----------------------------------------------------------------
def main():
    files = []  # (category, source, id, filename, abspath)
    for cat in sorted(os.listdir(SRC_ROOT)):
        cd = os.path.join(SRC_ROOT, cat)
        if not os.path.isdir(cd): continue
        for fn in sorted(os.listdir(cd)):
            if not fn.endswith((".mp4", ".jpg")): continue
            src = fn.split("-")[0]
            fid = fn[len(src)+1:].rsplit(".", 1)[0]
            files.append((cat, src, fid, fn, os.path.join(cd, fn)))
    print(f"found {len(files)} files; fetching keywords by source...")

    def kw(rec):
        cat, src, fid, fn, p = rec
        words = FETCH.get(src, lambda *_: [])(fid, fn)
        return rec, derive(words, cat)
    tagged = {}
    with ThreadPoolExecutor(max_workers=6) as ex:
        for i, (rec, tags) in enumerate(ex.map(kw, files), 1):
            tagged[rec[3]] = tags
            if i % 40 == 0: print(f"  ...{i}/{len(files)}")

    os.makedirs(POOL, exist_ok=True)
    items = []
    for cat, src, fid, fn, p in files:
        dest = os.path.join(POOL, fn)
        if os.path.abspath(p) != os.path.abspath(dest):
            os.replace(p, dest)
        if fn.endswith(".mp4"):
            d = mp4_dims(dest); dur = mp4_dur(dest)
            mbps = round(os.path.getsize(dest)*8/dur/1e6, 1) if dur else None
            kind, w, h = "video", (d[0] if d else None), (d[1] if d else None)
        else:
            kind, w, h, mbps = "photo", 1920, 1080, None
        items.append({"file": f"library/{fn}", "kind": kind, "source": src,
                      "width": w, "height": h, "mbps": mbps,
                      "bytes": os.path.getsize(dest), "tags": tagged[fn]})

    # remove now-empty old tree
    for cat in os.listdir(SRC_ROOT):
        cd = os.path.join(SRC_ROOT, cat)
        if os.path.isdir(cd) and not os.listdir(cd): os.rmdir(cd)
    if os.path.isdir(SRC_ROOT) and not os.listdir(SRC_ROOT): os.rmdir(SRC_ROOT)

    all_tags = {}
    for it in items:
        for t in it["tags"]:
            all_tags[t] = all_tags.get(t, 0) + 1
    man = {"name": "Cue Worship Backgrounds — Phase 1b curated media (flat pool + tags)",
           "generated": str(date.today()),
           "license": "Coverr/Mixkit/Pexels/Pixabay/Unsplash — free commercial, NO attribution",
           "spec": "16:9 landscape, >=1080p, video >=2.5 Mbps; categorize by `tags`, not folders",
           "count": len(items),
           "by_source": {s: sum(1 for i in items if i["source"] == s) for s in sorted({i["source"] for i in items})},
           "by_kind": {k: sum(1 for i in items if i["kind"] == k) for k in ("video", "photo")},
           "tag_counts": dict(sorted(all_tags.items(), key=lambda x: -x[1])),
           "items": sorted(items, key=lambda i: i["file"])}
    json.dump(man, open(os.path.join(BASE, "manifest.json"), "w"), indent=2)
    print(f"\nflattened -> {POOL}")
    print(f"manifest: {len(items)} items, {len(all_tags)} distinct tags")
    print("top tags:", list(man["tag_counts"].items())[:18])

if __name__ == "__main__":
    main()
