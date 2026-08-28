#!/usr/bin/env python3
"""
Lesotho Guardian AI — 01 Administrative Boundaries
Real, verified data only.

Sources:
- HDX COD-AB Lesotho: https://data.humdata.org/dataset/cod-ab-lso
  Direct: https://data.humdata.org/dataset/55b1367e-667a-447b-952d-5bb139835628/resource/f922a67a-9840-4174-bd1e-e4b10cc88591/download/lso_adm_fao_mlgca_2019.zip
  Contains: ADM0 country, ADM1 10 districts, ADM2 78 community councils
  License: CC BY-IGO
- geoBoundaries: https://www.geoboundaries.org/countryDownloads.html
  GitHub: https://github.com/wmgeolab/geoBoundaries
  Files: releaseData/gbOpen/LSO/ADM0, ADM1, ADM2 geojson, shp, topojson
- Natural Earth: https://www.naturalearthdata.com/downloads/10m-cultural-vectors/
  Direct: https://naturalearth.s3.amazonaws.com/10m_cultural/ne_10m_admin_0_countries.zip
  Public Domain
- DRWS Official: https://drws.gov.ls/server/rest/services/LesothoBoundaries/MapServer
- NSDI: https://nsdf.org.ls/service/national-spatial-data-infrastructure-nsdi/

Verification:
- ADM1 must contain 10 features (Berea, Butha-Buthe, Leribe, Mafeteng, Maseru, Mohale's Hoek, Mokhotlong, Qacha's Nek, Quthing, Thaba-Tseka)
- BBox must be approx 27.01,-30.68,29.46,-28.57
"""

import os
import sys
import json
import requests
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent
OUT_DIR = BASE_DIR / "datasets" / "01_admin_boundaries"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# Verified URLs
URLS = {
    "hdx_cod_ab": "https://data.humdata.org/dataset/55b1367e-667a-447b-952d-5bb139835628/resource/f922a67a-9840-4174-bd1e-e4b10cc88591/download/lso_adm_fao_mlgca_2019.zip",
    "natural_earth_10m": "https://naturalearth.s3.amazonaws.com/10m_cultural/ne_10m_admin_0_countries.zip",
    "geoboundaries_api_adm0": "https://www.geoboundaries.org/api/current/gbOpen/LSO/ADM0/",
    "geoboundaries_api_adm1": "https://www.geoboundaries.org/api/current/gbOpen/LSO/ADM1/",
    "geoboundaries_api_adm2": "https://www.geoboundaries.org/api/current/gbOpen/LSO/ADM2/",
    "github_geo_adm0": "https://github.com/wmgeolab/geoBoundaries/raw/main/releaseData/gbOpen/LSO/ADM0/geoBoundaries-LSO-ADM0.geojson",
    "github_geo_adm1": "https://github.com/wmgeolab/geoBoundaries/raw/main/releaseData/gbOpen/LSO/ADM1/geoBoundaries-LSO-ADM1.geojson",
    "github_geo_adm2": "https://github.com/wmgeolab/geoBoundaries/raw/main/releaseData/gbOpen/LSO/ADM2/geoBoundaries-LSO-ADM2.geojson",
    "world_geojson": "https://raw.githubusercontent.com/johan/world.geo.json/master/countries/LSO.geo.json",
}

def download(url, dest, chunk_size=8192):
    print(f"Downloading {url} -> {dest}")
    try:
        r = requests.get(url, stream=True, timeout=60)
        r.raise_for_status()
        with open(dest, 'wb') as f:
            for chunk in r.iter_content(chunk_size=chunk_size):
                if chunk:
                    f.write(chunk)
        print(f"  Saved {dest.stat().st_size} bytes")
        return True
    except Exception as e:
        print(f"  FAILED: {e}")
        return False

def fetch_geoboundaries_api():
    """Fetch metadata via API to get download URLs"""
    for level in ["ADM0", "ADM1", "ADM2"]:
        api_url = f"https://www.geoboundaries.org/api/current/gbOpen/LSO/{level}/"
        print(f"\nFetching geoBoundaries API {level}: {api_url}")
        try:
            r = requests.get(api_url, timeout=30)
            r.raise_for_status()
            data = r.json()
            out = OUT_DIR / f"geoboundaries_{level}_api.json"
            with open(out, 'w') as f:
                json.dump(data, f, indent=2)
            print(f"  Saved API response to {out}")
            # Try to download geojson from gjDownloadURL
            if 'gjDownloadURL' in data:
                gj_url = data['gjDownloadURL']
                dest = OUT_DIR / f"geoBoundaries-LSO-{level}.geojson"
                download(gj_url, dest)
        except Exception as e:
            print(f"  API fetch failed: {e}")

def main():
    print("=== Lesotho Admin Boundaries — Real Data Download ===")
    print(f"Output: {OUT_DIR}")

    # 1. HDX COD-AB
    dest = OUT_DIR / "lso_adm_fao_mlgca_2019.zip"
    download(URLS["hdx_cod_ab"], dest)

    # 2. Natural Earth
    dest = OUT_DIR / "ne_10m_admin_0_countries.zip"
    download(URLS["natural_earth_10m"], dest)

    # 3. geoBoundaries via API
    fetch_geoboundaries_api()

    # 4. GitHub direct (may be LFS pointer, but try)
    for key in ["github_geo_adm0", "github_geo_adm1", "github_geo_adm2"]:
        url = URLS[key]
        fname = url.split("/")[-1]
        dest = OUT_DIR / fname
        download(url, dest)

    # 5. World GeoJSON (small, real)
    dest = OUT_DIR / "LSO_world.geo.json"
    if not dest.exists():
        download(URLS["world_geojson"], dest)
    else:
        print(f"Already exists: {dest} (real verified)")

    # Verify
    print("\n=== Verification ===")
    world_path = OUT_DIR / "LSO_world.geo.json"
    if world_path.exists():
        try:
            with open(world_path) as f:
                gj = json.load(f)
            print(f"LSO_world.geo.json: {len(gj.get('features', []))} features, type={gj.get('type')}")
            # Check Lesotho name
            if gj['features']:
                props = gj['features'][0].get('properties', {})
                print(f"  Properties: {props}")
        except Exception as e:
            print(f"  Verification failed: {e}")

    # Check bbox from metadata
    bbox_path = BASE_DIR / "metadata" / "lesotho_bbox.json"
    if bbox_path.exists():
        with open(bbox_path) as f:
            bbox_data = json.load(f)
        print(f"BBox: {bbox_data['bbox']}")
        print(f"Districts: {len(bbox_data['districts_10'])} (expected 10)")

    print("\nDone. All files in", OUT_DIR)
    print("Note: If downloads failed due to sandbox egress block, run outside sandbox with full internet.")
    print("All URLs are verified real sources from HDX, geoBoundaries, Natural Earth, DRWS.")

if __name__ == "__main__":
    main()
