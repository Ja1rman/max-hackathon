#!/usr/bin/env python3
"""Maintain the Petr menu images and third-party photo attributions.

Usage: node --input-type=module -e "import {PETR_MENU} from './server/petr-menu.mjs'; console.log(JSON.stringify(PETR_MENU))" | python3 scripts/fetch-petr-photos.py
Existing project images are reused; third-party images retain their source and licence.
"""
import html
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public" / "petr-photos"
API = "https://commons.wikimedia.org/w/api.php"
USER_AGENT = "BanquetMenuPhotoFetcher/1.0"
PROJECT_ASSETS = {1, 2, 4, 6, 7, 8, 10, 11, 12, 14, 19, 20, 21, 22, 23, 24, 29, 32, 33, 44, 45, 68, 69, 70, 77, 78, 82, 83, 85, 86, 88, 90, 91, 92, 95, 105, 113, 130, 131, 133, 136, 138, 142, 145, 155, 158, 161, 162, 163, 164, 165, 167, 168, 169, 172}

KEYWORDS = [
    (r"икр", "caviar"), (r"лосос", "salmon"), (r"форел", "trout"),
    (r"кревет", "shrimp"), (r"тунец|тунц", "tuna"), (r"судак", "pike perch"),
    (r"дорад", "sea bream"), (r"треск", "cod"), (r"сельд", "herring"),
    (r"гребеш", "scallop"), (r"осьминог", "octopus"), (r"миди", "mussels"),
    (r"кальмар", "squid"), (r"рыб", "fish"), (r"говяд|ростбиф|бефстроганов|бифштекс", "beef"),
    (r"язык", "beef tongue"), (r"телят", "veal"), (r"ягн", "lamb"),
    (r"свин|поркетт|бужен", "pork"), (r"ветчин", "ham"),
    (r"прошут|парма", "prosciutto"), (r"чориз", "chorizo"),
    (r"индей", "turkey"), (r"курин|цыпл|наггет", "chicken"),
    (r"утин", "duck"), (r"гус", "goose"),
    (r"моцарел|моцарелл", "mozzarella"), (r"бри", "brie cheese"),
    (r"пармезан", "parmesan"), (r"сыр|чиз", "cheese"),
    (r"гриб|шампиньон|грузд", "mushroom"), (r"трюфел", "truffle"),
    (r"томат|помидор|черри", "tomato"), (r"баклажан", "eggplant"),
    (r"цукини|цуккини", "zucchini"), (r"картоф|пюре", "potato"),
    (r"брокколи", "broccoli"), (r"авокад", "avocado"), (r"олив|маслин", "olive"),
    (r"салат", "salad"), (r"греческ", "greek"), (r"цезар", "caesar"),
    (r"винегрет", "vinaigrette"), (r"оливье", "olivier salad"),
    (r"круассан", "croissant"), (r"блин|оладуш|оладьи", "pancake"),
    (r"печень|паштет", "pate"), (r"печенье", "cookies"),
    (r"фокачч", "focaccia"), (r"гриссини", "breadsticks"),
    (r"брускетт", "bruschetta"), (r"хлеб", "bread"),
    (r"шоколад", "chocolate"), (r"медовик", "honey cake"),
    (r"чизкейк", "cheesecake"), (r"панакот", "panna cotta"),
    (r"тирамис", "tiramisu"), (r"клубник", "strawberry"),
    (r"виноград", "grapes"), (r"ананас", "pineapple"),
    (r"мандари", "mandarin orange"), (r"груш", "pear"),
    (r"манго", "mango"), (r"суп", "soup"),
    (r"макарош|мак энд чиз", "macaroni cheese"), (r"фрикадел", "meatballs"),
    (r"морс", "berry drink"), (r"облепих", "sea buckthorn"),
    (r"клюкв", "cranberry"), (r"вишн", "cherry"),
    (r"малин", "raspberry"), (r"смородин", "blackcurrant"),
    (r"коктейль", "milkshake"), (r"морожен", "ice cream"),
    (r"лимонад", "lemonade"), (r"чай", "tea"),
    (r"вода", "water"), (r"сок", "fruit juice"),
]

CATEGORIES = {
    "Икорное предложение": "caviar appetizer",
    "Мини-закуски рыбные": "seafood canape",
    "Мини-закуски мясные": "meat canape",
    "Мини-закуски сырные и овощные": "vegetable cheese canape",
    "Горячие закуски": "hot appetizer",
    "Брускетты": "bruschetta",
    "Выпечка": "bakery pastry",
    "Десерты": "dessert",
    "Холодные закуски": "cold appetizer",
    "Горячее": "restaurant main course",
    "Салаты": "salad",
    "Гарниры": "vegetable side dish",
    "Фрукты": "fresh fruit",
    "Детское меню": "kids meal",
    "Пицца": "pizza",
    "Дополнительный заказ": "banquet buffet",
    "Напитки": "drink",
}

OVERRIDES = {
    1: "butter toast bread", 2: "tartlet butter egg", 3: "blini pancakes sour cream",
    5: "red caviar salmon roe", 6: "pike caviar roe",
    25: "pear brie cheese", 26: "ricotta cheese crostini", 28: "prunes parmesan walnuts",
    34: "stuffed mushrooms cheese", 35: "shrimp skewers", 36: "seafood skewers",
    37: "chicken skewers", 38: "salmon skewers", 39: "grilled vegetable skewers",
    49: "chocolate chip cookies", 50: "orange chocolate cookies",
    59: "fruit dessert cups", 60: "mini chocolate cake", 61: "honey layer cake",
    62: "cheesecake slice", 63: "meringue chocolate cake", 64: "white chocolate candy",
    65: "dark chocolate candy", 66: "cherry panna cotta glass",
    73: "vitello tonnato", 80: "cheese platter", 81: "cheese platter",
    84: "caprese salad mozzarella tomato", 86: "olives platter", 87: "sun dried tomatoes",
    88: "pickled vegetables platter", 89: "pickled mushrooms",
    97: "grilled salmon broccoli", 98: "grilled sea bream vegetables",
    99: "pike perch fish risotto", 100: "baked cod vegetables",
    101: "grilled octopus vegetables", 102: "beef stroganoff mashed potatoes",
    103: "beef steak grilled vegetables", 104: "braised beef cheeks mashed potatoes",
    105: "beef patty poached egg", 106: "lamb rack grilled vegetables",
    107: "roast pork potatoes", 108: "duck confit risotto",
    109: "roast turkey potatoes", 110: "greek salad feta",
    111: "broccoli avocado salad", 112: "beetroot herring salad",
    113: "beetroot mushroom salad", 114: "eggplant tomato salad",
    115: "duck salad", 116: "chicken pear walnut salad",
    117: "chicken caesar salad", 118: "shrimp caesar salad",
    120: "nicoise tuna salad", 123: "olivier beef salad", 124: "olivier chicken salad",
    126: "steamed broccoli cauliflower", 127: "mashed potatoes",
    128: "potato wedges", 129: "grilled vegetables", 130: "green beans",
    131: "whole roasted salmon shrimp", 132: "porchetta roast pork",
    133: "grilled lamb fillet", 134: "tomahawk beef steak",
    135: "roast goose", 136: "whole roast turkey oranges",
    137: "fruit platter", 144: "chicken soup", 145: "vegetable sticks",
    146: "macaroni and cheese", 147: "chicken nuggets", 148: "beef meatballs mashed potatoes",
    149: "french fries cheese sauce", 150: "milkshake glass", 151: "ice cream",
    152: "margherita pizza", 153: "four cheese pizza", 154: "capricciosa pizza",
    155: "pepperoni pizza", 156: "mushroom chicken pizza",
    157: "chocolate fountain fruit", 158: "cheese fondue fountain",
    159: "champagne glasses tower", 160: "champagne glasses pyramid",
    161: "restaurant staff meal", 162: "sea buckthorn berry drink",
    163: "cranberry drink", 164: "cherry drink", 165: "raspberry drink",
    166: "blackcurrant drink", 167: "bottled water plastic", 168: "bottled water glass",
    169: "fruit infused water pitcher", 170: "cola drink glass",
    171: "fruit juice glass", 172: "loose leaf tea cup",
}

def request(url):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(10):
        try:
            if url.startswith(API):
                time.sleep(3)
            with urllib.request.urlopen(req, timeout=25) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            if error.code != 429 or attempt == 9:
                raise
            time.sleep(min(90, 15 * (attempt + 1)))
        except (urllib.error.URLError, TimeoutError) as error:
            if attempt == 9:
                raise error
            time.sleep(1.5 * (attempt + 1))

def search(query):
    params = {"action": "query", "generator": "search", "gsrsearch": query + " filetype:bitmap", "gsrnamespace": 6, "gsrlimit": 25, "prop": "imageinfo", "iiprop": "url|mime|size|extmetadata", "iiurlwidth": 720, "format": "json"}
    data = json.loads(request(API + "?" + urllib.parse.urlencode(params)))
    return sorted(data.get("query", {}).get("pages", {}).values(), key=lambda page: page.get("index", 999))

def plain(value):
    return html.unescape(re.sub(r"<[^>]+>", "", value or "")).strip()

def candidates(item, number):
    if number in OVERRIDES:
        yield OVERRIDES[number]
    terms = [english for pattern, english in KEYWORDS if re.search(pattern, item["name"], re.I)]
    base = CATEGORIES[item["category"]]
    if terms:
        yield " ".join(terms[:2]) + " " + base
        yield terms[0] + " food"
    yield base + " food"
    yield "restaurant food plate"

def choose(item, number, used):
    for query in dict.fromkeys(candidates(item, number)):
        for page in search(query):
            info = page.get("imageinfo", [{}])[0]
            licence = plain(info.get("extmetadata", {}).get("LicenseShortName", {}).get("value"))
            if page["pageid"] in used or info.get("mime") != "image/jpeg" or info.get("width", 0) < 500 or info.get("height", 0) < 360:
                continue
            if not (licence.startswith("CC BY") or licence in ("CC0", "Public domain", "PD")):
                continue
            if any(word in page["title"].lower() for word in ("journal", "dictionary", "advertisement", "poster", "drawing")):
                continue
            used.add(page["pageid"])
            return page, info, query, licence
    raise RuntimeError(f"No photograph found for {number}: {item['name']}")

def main():
    menu = json.load(sys.stdin)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    manifest_path = OUTPUT / "credits.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    used = {entry["pageId"] for entry in manifest.values() if entry.get("pageId")}
    for number, item in enumerate(menu, 1):
        key = f"{number:03d}"
        if key in manifest and (OUTPUT / manifest[key]["file"]).exists() and (number not in PROJECT_ASSETS or (manifest[key]["file"] == f"{key}.jpg" and manifest[key].get("source") == "Иллюстрация проекта")):
            continue
        if number in PROJECT_ASSETS:
            file = f"{key}.jpg"
            if not (OUTPUT / file).exists():
                raise FileNotFoundError(f"Expected project image asset: {OUTPUT / file}")
            entry = {"dish": item["name"], "file": file, "source": "Иллюстрация проекта", "license": "Project asset"}
        else:
            page, info, query, licence = choose(item, number, used)
            file = f"{key}.jpg"
            (OUTPUT / file).write_bytes(request(info.get("thumburl") or info["url"]))
            metadata = info.get("extmetadata", {})
            entry = {"dish": item["name"], "file": file, "pageId": page["pageid"], "source": info["descriptionurl"], "artist": plain(metadata.get("Artist", {}).get("value")), "license": licence, "licenseUrl": metadata.get("LicenseUrl", {}).get("value", ""), "query": query}
        manifest[key] = entry
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
        print(f"{number:03d}/{len(menu)} {item['name']} -> {file}", flush=True)
    lines = ["<!doctype html><html lang='ru'><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1'><title>Атрибуция сторонних фотографий</title><style>body{font:16px/1.5 system-ui;margin:auto;max-width:900px;padding:24px;color:#193d2b}li{margin:0 0 12px}a{color:#17664b}</style><h1>Атрибуция сторонних фотографий</h1><p>Фотографии иллюстрируют блюда; подача в ресторане может отличаться.</p><ol>"]
    for key in sorted(manifest):
        entry = manifest[key]
        if entry.get("license") == "Project asset":
            continue
        source = entry.get("source", "")
        license_url = entry.get("licenseUrl", "")
        lines.append(f"<li>{html.escape(entry['dish'])}: <a href='{html.escape(source, quote=True)}'>{html.escape(entry.get('artist') or source)}</a> · <a href='{html.escape(license_url, quote=True)}'>{html.escape(entry['license'])}</a></li>" if license_url else f"<li>{html.escape(entry['dish'])}: {html.escape(source)}</li>")
    (OUTPUT / "credits.html").write_text("\n".join(lines + ["</ol></html>"]))

if __name__ == "__main__":
    main()
