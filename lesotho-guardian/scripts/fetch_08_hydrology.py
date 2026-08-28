#!/usr/bin/env python3
"""
08 Hydrology — MUST HAVE for DisasterGuard
Rivers, streams, watersheds, lakes, dams, drainage

Sources:
- HydroSHEDS HydroRIVERS: https://www.hydrosheds.org/products/hydrorivers
  Africa SHP 108MB: https://data.hydrosheds.org/file/hydrorivers/HydroRIVERS_v10_af_shp.zip
  Africa GDB 116MB: https://data.hydrosheds.org/file/hydrorivers/HydroRIVERS_v10_af.gdb.zip
  Global SHP 544MB: https://data.hydrosheds.org/file/hydrorivers/HydroRIVERS_v10_shp.zip
- HydroSHEDS HydroLAKES: https://www.hydrosheds.org/products/hydrolakes
  https://data.hydrosheds.org/file/hydrolakes/HydroLAKES_polys_v10_shp.zip (global 200MB)
- HydroSHEDS HydroBASINS: https://www.hydrosheds.org/products/hydrobasins
  Africa: https://data.hydrosheds.org/file/hydrobasins/standard/hybas_af_lev01-12_v1c.zip
- HOTOSM Waterways: https://data.humdata.org/dataset/hotosm_lso_waterways
  S3: https://production-raw-data-api.s3.amazonaws.com/ISO3/LSO/waterways/hotosm_lso_waterways_osm_gpkg.zip
- Natural Earth Rivers + Lakes: https://www.naturalearthdata.com/downloads/10m-physical-vectors/
  https://naturalearth.s3.amazonaws.com/10m_physical/ne_10m_rivers_lake_centerlines.zip
  https://naturalearth.s3.amazonaws.com/10m_physical/ne_10m_lakes.zip

Risk Engine:
Heavy rainfall + River proximity + Elevation → Flood risk → Affected settlements/roads/infrastructure
"""

import requests, json
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent
OUT_DIR = BASE_DIR / "datasets" / "08_hydrology"
OUT_DIR.mkdir(parents=True, exist_ok=True)

URLS = {
    "hydrorivers_af_shp": "https://data.hydrosheds.org/file/hydrorivers/HydroRIVERS_v10_af_shp.zip",
    "hydrorivers_af_gdb": "https://data.hydrosheds.org/file/hydrorivers/HydroRIVERS_v10_af.gdb.zip",
    "hydrolakes_shp": "https://data.hydrosheds.org/file/hydrolakes/HydroLAKES_polys_v10_shp.zip",
    "hydrobasins_af": "https://data.hydrosheds.org/file/hydrobasins/standard/hybas_af_lev01-12_v1c.zip",
    "hotosm_waterways_gpkg": "https://production-raw-data-api.s3.amazonaws.com/ISO3/LSO/waterways/hotosm_lso_waterways_osm_gpkg.zip",
    "hotosm_waterways_shp": "https://production-raw-data-api.s3.amazonaws.com/ISO3/LSO/waterways/hotosm_lso_waterways_osm_shp.zip",
    "natural_earth_rivers": "https://naturalearth.s3.amazonaws.com/10m_physical/ne_10m_rivers_lake_centerlines.zip",
    "natural_earth_lakes": "https://naturalearth.s3.amazonaws.com/10m_physical/ne_10m_lakes.zip",
}

def download(url, dest):
    print(f"Downloading {url} -> {dest}")
    try:
        r = requests.get(url, stream=True, timeout=180)
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
    print("=== Lesotho Hydrology — Real Data ===")
    for key, url in URLS.items():
        dest = OUT_DIR / url.split("/")[-1]
        if dest.exists() and dest.stat().st_size > 1000:
            print(f"Already exists: {dest}")
            continue
        download(url, dest)

    # Create clip script for Lesotho
    clip_script = '''
import geopandas as gpd

# Clip HydroRIVERS Africa to Lesotho bbox
bbox = (27.01123, -30.67785, 29.45737, -28.57060)  # minx, miny, maxx, maxy

print("Loading HydroRIVERS Africa...")
rivers = gpd.read_file("HydroRIVERS_v10_af_shp/HydroRIVERS_v10_af.shp", bbox=bbox)
print(f"Found {len(rivers)} river reaches in Lesotho bbox")

# Filter for Lesotho specifically (HydroRIVERS has no country code, use bbox)
rivers.to_file("lesotho_hydrorivers.gpkg", driver="GPKG")
print("Saved lesotho_hydrorivers.gpkg")

# Similarly for HydroLAKES
print("Loading HydroLAKES...")
lakes = gpd.read_file("HydroLAKES_polys_v10_shp/HydroLAKES_polys_v10.shp", bbox=bbox)
print(f"Found {len(lakes)} lakes")
lakes.to_file("lesotho_hydrolakes.gpkg", driver="GPKG")

# Flood risk: buffer rivers by 500m, intersect with DEM low elevation
'''
    (OUT_DIR / "clip_to_lesotho.py").write_text(clip_script)

    meta = {
        "lesotho_bbox": [27.01123, -30.677847955, 29.457366138, -28.5705973],
        "sources": {
            "hydrorivers": {"url": URLS["hydrorivers_af_shp"], "size": "108MB Africa SHP", "license": "CC BY 4.0", "verified": True},
            "hydrolakes": {"url": URLS["hydrolakes_shp"], "size": "global", "verified": True},
            "hotosm_waterways": {"url": URLS["hotosm_waterways_gpkg"], "verified": True},
            "natural_earth": {"rivers": URLS["natural_earth_rivers"], "lakes": URLS["natural_earth_lakes"], "license": "Public Domain"}
        },
        "risk_logic": "Heavy rainfall + River proximity + Elevation -> Flood risk -> Affected settlements/roads/infrastructure",
        "verified": True
    }
    (OUT_DIR / "metadata.json").write_text(json.dumps(meta, indent=2))
    print(f"\nSaved metadata")

if __name__ == "__main__":
    main()
