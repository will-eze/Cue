#!/usr/bin/env python3
"""
Phase 1b — add a lightweight `thumb` (poster) URL to each manifest item so the
Background picker grid can preview without pulling full-res media.

Thumbs are derived from the resolved `url` (no API call) for every source except
Pexels, which needs a by-id re-fetch for its `.image` poster:
  coverr   : <base>/thumbnail?width=480           (url ends /1080p.mp4)
  mixkit   : ...-1080.mp4 -> ...-thumb-720-0.jpg   (both url forms)
  pixabay  : ....mp4      -> ....jpg               (per-rendition poster)
  unsplash : w=1920&h=1080 -> w=480&h=270          (it's already a photo)
  pexels   : GET /videos/videos/<id> -> .image     [PEXELS_API_KEY]

Each derived thumb is liveness-checked. Run:
  PEXELS_API_KEY=.. python3 scripts/add-thumbnails.py
"""
import json, os, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor

BASE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "resources")
MANIFEST = os.path.join(BASE, "media-manifest.json")
UA = "Mozilla/5.0"
PEXELS_KEY = os.environ.get("PEXELS_API_KEY", "")

def live(url):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Range": "bytes=0-1"})
        with urllib.request.urlopen(req, timeout=25) as r:
            return r.status in (200, 206)
    except Exception:
        return False

def derive(it):
    src, url = it["source"], it.get("url")
    if not url:
        return None
    if src == "coverr":
        return url.replace("/1080p.mp4", "/thumbnail?width=480")
    if src == "pixabay":
        return url.rsplit(".mp4", 1)[0] + ".jpg"
    if src == "unsplash":
        return url.replace("w=1920&h=1080", "w=480&h=270")
    if src == "mixkit":
        if "-video-1080.mp4" in url:
            return url.replace("-video-1080.mp4", "-video-thumb-720-0.jpg")
        return url.replace("-1080.mp4", "-thumb-720-0.jpg")
    if src == "pexels":
        if not PEXELS_KEY:
            return None
        vid = os.path.basename(it["file"]).split("-")[1].split(".")[0]
        try:
            req = urllib.request.Request(f"https://api.pexels.com/videos/videos/{vid}",
                                         headers={"User-Agent": UA, "Authorization": PEXELS_KEY})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read()).get("image")
        except Exception:
            return None
    return None

def main():
    man = json.load(open(MANIFEST))
    items = man["items"]

    def work(it):
        t = derive(it)
        return it, (t if (t and live(t)) else None)

    ok = fail = 0
    with ThreadPoolExecutor(max_workers=8) as ex:
        for it, thumb in ex.map(work, items):
            if thumb:
                it["thumb"] = thumb; ok += 1
            else:
                it.pop("thumb", None); fail += 1

    json.dump(man, open(MANIFEST, "w"), indent=2)
    have = sum(1 for i in items if i.get("thumb"))
    print(f"thumbs: {ok} added/live, {fail} missing  ->  {have}/{len(items)} items have a thumb")
    miss = [i["file"] for i in items if not i.get("thumb")]
    if miss:
        print("missing thumb:")
        for f in miss: print("  -", f)

if __name__ == "__main__":
    main()
