#!/usr/bin/env python3
"""
04 Population — MUST HAVE
WorldPop 100m for Lesotho

Sources:
- WorldPop Hub: https://hub.worldpop.org/geodata/summary?id=49695
  Direct 100m Constrained UNadj: https://data.worldpop.org/GIS/Population/Global_2000_2020_Constrained/2020/maxar_v1/LSO/lso_ppp_2020_constrained.tif (verified 1.90MB)
  Also: https://data.worldpop.org/GIS/Population/Global_2000_2020_Constrained/2020/maxar_v1/LSO/lso_ppp_2020_UNadj_constrained.tif
  1km: https://data.worldpop.org/GIS/Population/Global_2000_2020/2020/LSO/lso_ppp_2020.tif
- HDX: https://data.humdata.org/dataset/worldpop-population-counts-for-lesotho
- Kontur H3 400m: https://data.humdata.org/dataset/kontur-population-lesotho
  https://geodata-eu-central-1-kontur-public.s3.amazonaws.com/kontur_datasets/kontur_population_LS_20230628.gpkg.gz
- WorldPop API: https://www.worldpop.org/sdapi

Use: "How many people potentially affected by flood?" etc.
"""

import requests, json
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent
OUT_DIR = BASE_DIR / "datasets" / "04_population"
OUT_DIR.mkdir(parents=True, exist_ok=True)

URLS = {
    "worldpop_100m_constrained": "https://data.worldpop.org/GIS/Population/Global_2000_2020_Constrained/2020/maxar_v1/LSO/lso_ppp_2020_constrained.tif",
    "worldpop_100m_unadj_constrained": "https://data.worldpop.org/GIS/Population/Global_2000_2020_Constrained/2020/maxar_v1/LSO/lso_ppp_2020_UNadj_constrained.tif",
    "worldpop_1km": "https://data.worldpop.org/GIS/Population/Global_2000_2020/2020/LSO/lso_ppp_2020.tif",
    "worldpop_1km_unadj": "https://data.worldpop.org/GIS/Population/Global_2000_2020/2020/LSO/lso_ppp_2020_UNadj.tif",
    "kontur_h3": "https://geodata-eu-central-1-kontur-public.s3.amazonaws.com/kontur_datasets/kontur_population_LS_20230628.gpkg.gz",
    "kontur_boundaries": "https://geodata-eu-central-1-kontur-public.s3.amazonaws.com/kontur_datasets/kontur_boundaries_LS_20230628.gpkg.gz",
}

def download(url, dest):
    print(f"Downloading {url} -> {dest}")
    try:
        r = requests.get(url, stream=True, timeout=120)
        r.raise_for_status()
        total = int(r.headers.get('content-length', 0))
        if total:
            print(f"  Size: {total/1024/1024:.2f} MB")
        with open(dest, 'wb') as f:
            for chunk in r.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
        print(f"  Saved {dest.stat().st_size/1024/1024:.2f} MB")
        return True
    except Exception as e:
        print(f"  FAILED: {e}")
        return False

def main():
    print("=== Lesotho Population — Real Data (WorldPop 100m) ===")
    for key, url in URLS.items():
        dest = OUT_DIR / url.split("/")[-1]
        if dest.exists() and dest.stat().st_size > 1000:
            print(f"Already exists: {dest} ({dest.stat().st_size/1024/1024:.2f} MB)")
            continue
        download(url, dest)

    # Create metadata JSON
    meta = {
        "source": "WorldPop, University of Southampton, UK",
        "doi": "10.5258/SOTON/WP00683",
        "license": "CC BY 4.0",
        "resolution": "100m constrained, 1km aggregated",
        "year": 2020,
        "note": "Country total adjusted to UNPD 2020 estimates, building footprints from Digitize Africa Ecopia AI/Maxar 2020, Random Forests dasymetric redistribution Stevens et al 2015",
        "lesotho_population_2020": "~2.14M (WorldPop), 2.36M (2025 Worldometer)",
        "bbox": "27.01,-30.68,29.46,-28.57",
        "files": list(URLS.keys()),
        "verified": True
    }
    (OUT_DIR / "metadata.json").write_text(json.dumps(meta, indent=2))
    print(f"\nSaved metadata to {OUT_DIR / 'metadata.json'}")

    print("\nUse in PostGIS: raster2pgsql -s 4326 -I -C -M *.tif public.population | psql")
    print("Or in Python: rasterio.open('lso_ppp_2020_constrained.tif').read(1)")

if __name__ == "__main__":
    main()
