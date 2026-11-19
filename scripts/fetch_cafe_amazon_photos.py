import os, re, csv, json, time, hashlib
from pathlib import Path
from urllib.parse import urljoin
import requests
from bs4 import BeautifulSoup

menu_url = os.environ["MENU_URL"]
out = Path("product-photos")
out.mkdir(exist_ok=True)
s = requests.Session()
s.headers.update({"User-Agent":"Mozilla/5.0 (compatible; CafeAmazonPhotoFetcher/1.0)"})
r = s.get(menu_url, timeout=40)
r.raise_for_status()
html = r.text
soup = BeautifulSoup(html, "html.parser")

def norm(x):
    x = re.sub(r'[^0-9A-Za-zก-๙]+','-',x.strip()).strip('-').lower()
    return x or "product"

# Extract menu item names and nearby image URLs from rendered HTML/embedded JSON.
items = {}
for tag in soup.find_all(["img"]):
    src = tag.get("src") or tag.get("data-src") or ""
    alt = (tag.get("alt") or "").strip()
    if "img.wongnai.com" in src and alt:
        items.setdefault(alt, src)
for m in re.finditer(r'(?P<url>https?:\\?/\\?/img\\.wongnai\\.com[^"\\s<>]+?\\.(?:jpg|jpeg|png|webp))', html, re.I):
    u = m.group("url").replace("\\/", "/").replace("&amp;","&")
    items.setdefault("photo-" + hashlib.md5(u.encode()).hexdigest()[:8], u)

rows=[]
for idx,(name,url) in enumerate(items.items(),1):
    url=url.replace("\\/", "/")
    if url.startswith("//"): url="https:"+url
    if url.startswith("/"): url=urljoin(menu_url,url)
    try:
        resp=s.get(url,timeout=30)
        resp.raise_for_status()
        ctype=resp.headers.get("content-type","")
        if not ctype.startswith("image/"): raise ValueError("not an image response")
        ext=".jpg" if "jpeg" in ctype or "jpg" in ctype else (".png" if "png" in ctype else ".webp")
        filename=f"{idx:03d}_{norm(name)}{ext}"
        (out/filename).write_bytes(resp.content)
        rows.append({"menu_product_name":name,"source_url":url,"filename":filename,"bytes":len(resp.content),"status":"downloaded"})
    except Exception as e:
        rows.append({"menu_product_name":name,"source_url":url,"filename":"","bytes":0,"status":f"failed: {e}"})
    time.sleep(0.35)
with (out/"mapping.csv").open("w",newline="",encoding="utf-8-sig") as f:
    w=csv.DictWriter(f,fieldnames=["menu_product_name","source_url","filename","bytes","status"])
    w.writeheader(); w.writerows(rows)
(out/"README.txt").write_text("Photos and mapping.csv extracted from the supplied Wongnai menu page. Match menu_product_name to the store product catalog before updating Supabase image_url. No unverified product mapping is applied.\n",encoding="utf-8")
print(f"Extracted {sum(x['status']=='downloaded' for x in rows)} images; {len(rows)} records.")
