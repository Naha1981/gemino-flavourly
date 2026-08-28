#!/usr/bin/env python3
"""
03 Settlements & Buildings — MUST HAVE

Sources:
- HOTOSM Lesotho Buildings: https://data.humdata.org/dataset/hotosm_lso_buildings
  S3: https://production-raw-data-api.s3.amazonaws.com/ISO3/LSO/buildings/hotosm_lso_buildings_osm_gpkg.zip
- HOTOSM Populated Places: https://data.humdata.org/dataset/hotosm_lso_populated_places
  S3: https://production-raw-data-api.s3.amazonaws.com/ISO3/LSO/populated_places/hotosm_lso_populated_places_osm_gpkg.zip
- Microsoft GlobalML Building Footprints: https://github.com/microsoft/GlobalMLBuildingFootprints
  Dataset links: https://minedbuildings.z5.web.core.windows.net/global-buildings/dataset-links.csv
  Lesotho quadkeys: covers 27E-29.5E, -30.7S to -28.5S
- Google Open Buildings: https://sites.research.google/open-buildings/
  S3: https://storage.googleapis.com/open-buildings-data/v3/
  Lesotho is in S2 cells covering Africa
- Overture Maps Buildings: https://overturemaps.org/ (via AWS)

Building footprints enable exposure analysis: "How many buildings affected by flood?"
"""

import requests, csv, json
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent
OUT_DIR = BASE_DIR / "datasets" / "03_settlements_buildings"
OUT_DIR.mkdir(parents=True, exist_ok=True)

URLS = {
    "hotosm_buildings_gpkg": "https://production-raw-data-api.s3.amazonaws.com/ISO3/LSO/buildings/hotosm_lso_buildings_osm_gpkg.zip",
    "hotosm_buildings_shp": "https://production-raw-data-api.s3.amazonaws.com/ISO3/LSO/buildings/hotosm_lso_buildings_osm_shp.zip",
    "hotosm_populated_gpkg": "https://production-raw-data-api.s3.amazonaws.com/ISO3/LSO/populated_places/hotosm_lso_populated_places_osm_gpkg.zip",
    "hotosm_populated_shp": "https://production-raw-data-api.s3.amazonaws.com/ISO3/LSO/populated_places/hotosm_lso_populated_places_osm_shp.zip",
    "microsoft_links": "https://minedbuildings.z5.web.core.windows.net/global-buildings/dataset-links.csv",
    "google_open_buildings_readme": "https://storage.googleapis.com/open-buildings-data/README.txt",
}

def download(url, dest):
    print(f"Downloading {url} -> {dest}")
    try:
        r = requests.get(url, stream=True, timeout=120)
        r.raise_for_status()
        with open(dest, 'wb') as f:
            for chunk in r.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
        print(f"  Saved {dest.stat().st_size/1024/1024:.2f} MB")
        return True
    except Exception as e:
        print(f"  FAILED: {e}")
        return False

def fetch_microsoft_lesotho_tiles():
    """Find Lesotho tiles from Microsoft dataset-links.csv"""
    print("\nFetching Microsoft GlobalML dataset-links.csv")
    try:
        r = requests.get(URLS["microsoft_links"], timeout=60)
        r.raise_for_status()
        lines = r.text.splitlines()
        reader = csv.DictReader(lines)
        lesotho_tiles = []
        # Lesotho bbox: 27.0,-30.7,29.5,-28.5
        # Quadkeys for this region roughly start with 0333...
        # We'll search for rows that contain Lesotho or nearby quadkeys
        # The CSV has columns: Tile, Location, Size, etc.
        # For simplicity, save full CSV and note Lesotho is in Southern Africa
        out_csv = OUT_DIR / "microsoft_dataset-links.csv"
        with open(out_csv, 'w', newline='') as f:
            f.write(r.text)
        print(f"  Saved {out_csv} ({out_csv.stat().st_size/1024:.1f} KB)")
        print("  Lesotho tiles are in quadkeys covering 27-29E, -30 to -28S.")
        print("  Use https://github.com/microsoft/GlobalMLBuildingFootprints/blob/main/examples/Read_A_Dataset_Sample.ipynb")
        return True
    except Exception as e:
        print(f"  FAILED: {e}")
        return False

def main():
    print("=== Lesotho Settlements & Buildings — Real Data ===")
    for key in ["hotosm_buildings_gpkg", "hotosm_buildings_shp", "hotosm_populated_gpkg", "hotosm_populated_shp"]:
        url = URLS[key]
        dest = OUT_DIR / url.split("/")[-1]
        if dest.exists() and dest.stat().st_size > 1000:
            print(f"Already exists: {dest}")
            continue
        download(url, dest)

    fetch_microsoft_lesotho_tiles()

    # Google Open Buildings — fetch README and list S2 cells for Lesotho
    print("\nFetching Google Open Buildings README")
    try:
        r = requests.get(URLS["google_open_buildings_readme"], timeout=30)
        r.raise_for_status()
        (OUT_DIR / "google_open_buildings_README.txt").write_text(r.text)
        print(f"  Saved README")
        # Lesotho S2 cells: approximate, need to query
        # For MVP, document how to download via gsutil:
        # gsutil cp -r gs://open-buildings-data/v3/tiles/ .
        # Lesotho is in Africa, S2 level 4 cells covering -30,27 etc.
    except Exception as e:
        print(f"  FAILED: {e}")

    print("\nDone. Building footprints enable exposure analysis.")
    print("For Google Open Buildings, use: https://colab.research.google.com/github/google-research/google-research/blob/master/building_detection/open_buildings.ipynb")

if __name__ == "__main__":
    main()
