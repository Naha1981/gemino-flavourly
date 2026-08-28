#!/usr/bin/env python3
"""
02 Roads & Transport — MUST HAVE
Real verified data.

Sources:
- Geofabrik Lesotho OSM PBF 119MB: https://download.geofabrik.de/africa/lesotho.html
  Direct: https://download.geofabrik.de/africa/lesotho-latest.osm.pbf
  Direct SHP: https://download.geofabrik.de/africa/lesotho-latest-free.shp.zip
- HOTOSM Lesotho Roads HDX: https://data.humdata.org/dataset/hotosm_lso_roads
  S3: https://production-raw-data-api.s3.amazonaws.com/ISO3/LSO/roads/hotosm_lso_roads_osm_gpkg.zip (34M)
      https://production-raw-data-api.s3.amazonaws.com/ISO3/LSO/roads/hotosm_lso_roads_osm_shp.zip (32.6M)
- WFP GeoNode: https://geonode.wfp.org/layers/geonode:lso_trs_roads_osm

Contains: motorway, trunk, primary, secondary, tertiary, residential, track, bridge, crossing
"""

import requests
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent
OUT_DIR = BASE_DIR / "datasets" / "02_roads_transport"
OUT_DIR.mkdir(parents=True, exist_ok=True)

URLS = {
    "geofabrik_pbf": "https://download.geofabrik.de/africa/lesotho-latest.osm.pbf",
    "geofabrik_shp": "https://download.geofabrik.de/africa/lesotho-latest-free.shp.zip",
    "geofabrik_poly": "https://download.geofabrik.de/africa/lesotho.poly",
    "hotosm_gpkg": "https://production-raw-data-api.s3.amazonaws.com/ISO3/LSO/roads/hotosm_lso_roads_osm_gpkg.zip",
    "hotosm_shp": "https://production-raw-data-api.s3.amazonaws.com/ISO3/LSO/roads/hotosm_lso_roads_osm_shp.zip",
    "hotosm_geojson_old": "https://s3.dualstack.us-east-1.amazonaws.com/production-raw-data-api/ISO3/LSO/roads/lines/hotosm_lso_roads_lines_geojson.zip",
}

def download(url, dest):
    print(f"Downloading {url} -> {dest}")
    try:
        r = requests.get(url, stream=True, timeout=120)
        r.raise_for_status()
        total = int(r.headers.get('content-length', 0))
        print(f"  Size: {total/1024/1024:.2f} MB" if total else "  Size: unknown")
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
    print("=== Lesotho Roads & Transport — Real Data ===")
    for key, url in URLS.items():
        fname = url.split("/")[-1]
        dest = OUT_DIR / fname
        if dest.exists() and dest.stat().st_size > 1000:
            print(f"Already exists: {dest} ({dest.stat().st_size/1024/1024:.2f} MB)")
            continue
        download(url, dest)

    print("\n=== Overpass Query Example (for critical infrastructure script) ===")
    overpass_query = """
    [out:json][timeout:60];
    area["ISO3166-1"="LS"]["admin_level"="2"]->.searchArea;
    (
      way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"](area.searchArea);
      way["highway"="residential"](area.searchArea);
      way["bridge"="yes"](area.searchArea);
    );
    out geom qt;
    """
    (OUT_DIR / "overpass_roads_example.oql").write_text(overpass_query)
    print(f"Saved example Overpass query to {OUT_DIR / 'overpass_roads_example.oql'}")

    print("\nDone. Use Geofabrik PBF with osm2pgsql or ogr2ogr for PostGIS.")
    print("Example: ogr2ogr -f PostgreSQL PG:dbname=lesotho lesotho-latest.osm.pbf -oo CONFIG_FILE=osmconf.ini")

if __name__ == "__main__":
    main()
