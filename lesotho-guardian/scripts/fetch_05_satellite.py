#!/usr/bin/env python3
"""
05 Satellite Imagery — MUST HAVE
Sentinel-1 SAR, Sentinel-2 Optical, Landsat

We don't download entire country manually. Build ingestion pipeline that pulls imagery for areas/events.

Sources:
- Copernicus Dataspace STAC: https://stac.dataspace.copernicus.eu/v1
  Collections: SENTINEL-1, SENTINEL-2
  Docs: https://documentation.dataspace.copernicus.eu/APIs/STAC.html
- Microsoft Planetary Computer STAC: https://planetarycomputer.microsoft.com/api/stac/v1
  Collections: sentinel-2-l2a, sentinel-1-rtc, landsat-c2-l2
  Example: https://planetarycomputer.microsoft.com/api/stac/v1/collections/sentinel-2-l2a
- USGS Landsat STAC: https://landsatlook.usgs.gov/stac-server
- AWS Open Data: s3://sentinel-s2-l2a, s3://sentinel-s1-rtc-indigo

Lesotho BBox: 27.01123, -30.67785, 29.45737, -28.57060
"""

import json
from pathlib import Path
from datetime import datetime, timedelta

BASE_DIR = Path(__file__).parent.parent
OUT_DIR = BASE_DIR / "datasets" / "05_satellite_imagery"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# Example ingestion pipeline using pystac-client
SCRIPT_TEMPLATE = '''
# Install: pip install pystac-client planetary-computer rasterio
from pystac_client import Client
import planetary_computer
import stackstac
import rasterio
from datetime import datetime

# Lesotho BBox
LESOTHO_BBOX = [27.01123, -30.677847955, 29.457366138, -28.5705973]  # min_lon, min_lat, max_lon, max_lat

# Option 1: Planetary Computer (free, no key, easiest)
client = Client.open("https://planetarycomputer.microsoft.com/api/stac/v1")

# Sentinel-2 L2A — last 30 days
search = client.search(
    collections=["sentinel-2-l2a"],
    bbox=LESOTHO_BBOX,
    datetime="2024-01-01/2024-12-31",
    query={"eo:cloud_cover": {"lt": 20}},
    limit=10
)
items = search.item_collection()
print(f"Found {len(items)} Sentinel-2 items")
for item in items[:3]:
    print(item.id, item.datetime, item.properties.get("eo:cloud_cover"))

# Sentinel-1 RTC (SAR, works through clouds/night)
search_s1 = client.search(
    collections=["sentinel-1-rtc"],
    bbox=LESOTHO_BBOX,
    datetime="2024-01-01/2024-12-31",
    limit=5
)
print(f"Found {len(search_s1.item_collection())} Sentinel-1 items")

# Option 2: Copernicus Dataspace STAC (requires token for download, but search is open)
# client_cdse = Client.open("https://stac.dataspace.copernicus.eu/v1")
# search = client_cdse.search(collections=["SENTINEL-2"], bbox=LESOTHO_BBOX, datetime="2024-01-01/2024-12-31", limit=5)

# Option 3: Download sample via stackstac
# stack = stackstac.stack(items, epsg=4326, resolution=0.0001, bounds_latlon=LESOTHO_BBOX)
# stack.to_netcdf("lesotho_s2_sample.nc")
'''

def create_ingestion_scripts():
    (OUT_DIR / "ingestion_planetary_computer.py").write_text(SCRIPT_TEMPLATE)
    print(f"Saved {OUT_DIR / 'ingestion_planetary_computer.py'}")

    # Copernicus DEM + Sentinel via boto3
    copernicus_script = '''
# Copernicus DEM via AWS (no key, public)
import boto3
from botocore import UNSIGNED
from botocore.client import Config

s3 = boto3.client('s3', config=Config(signature_version=UNSIGNED), region_name='eu-central-1')
# List tiles covering Lesotho: S30_E027, S29_E027, etc.
# Lesotho lat -30 to -28, lon 27 to 29
tiles = [
    "Copernicus_DSM_COG_10_S30_00_E027_00_DEM/Copernicus_DSM_COG_10_S30_00_E027_00_DEM.tif",
    "Copernicus_DSM_COG_10_S30_00_E028_00_DEM/Copernicus_DSM_COG_10_S30_00_E028_00_DEM.tif",
    "Copernicus_DSM_COG_10_S29_00_E027_00_DEM/Copernicus_DSM_COG_10_S29_00_E027_00_DEM.tif",
    "Copernicus_DSM_COG_10_S29_00_E028_00_DEM/Copernicus_DSM_COG_10_S29_00_E028_00_DEM.tif",
    "Copernicus_DSM_COG_10_S30_00_E029_00_DEM/Copernicus_DSM_COG_10_S30_00_E029_00_DEM.tif",
    "Copernicus_DSM_COG_10_S29_00_E029_00_DEM/Copernicus_DSM_COG_10_S29_00_E029_00_DEM.tif",
]
for tile in tiles:
    print(f"Downloading {tile}")
    try:
        s3.download_file('copernicus-dem-30m', tile, f"./{tile.split('/')[-1]}")
    except Exception as e:
        print(f"  Failed: {e}")
'''
    (OUT_DIR / "download_copernicus_dem.py").write_text(copernicus_script)

    # FIRMS + Sentinel integration example
    integration = '''
# Lesotho Guardian — Risk Engine: satellite + weather + terrain
# Heavy rainfall + River proximity + Elevation → Flood risk → Affected settlements/roads/infrastructure

# 1. Get latest Sentinel-1 for flood detection (SAR)
# 2. Get CHIRPS rainfall anomaly
# 3. Get Copernicus DEM for elevation
# 4. Get HydroRIVERS for river proximity
# 5. Calculate affected population via WorldPop
# 6. Push to PostGIS + Cesium 3D

# Pseudo:
# flood_mask = detect_flood_sentinel1(s1_image, dem)
# affected_pop = zonal_stats(flood_mask, worldpop_tif)
# affected_roads = intersect(flood_mask, osm_roads)
# affected_buildings = intersect(flood_mask, microsoft_buildings)
'''
    (OUT_DIR / "risk_engine_pseudo.py").write_text(integration)

def main():
    print("=== Lesotho Satellite Imagery — Ingestion Pipeline ===")
    create_ingestion_scripts()

    # Save STAC endpoints
    stac_info = {
        "lesotho_bbox": [27.01123, -30.677847955, 29.457366138, -28.5705973],
        "endpoints": {
            "copernicus_dataspace": "https://stac.dataspace.copernicus.eu/v1",
            "planetary_computer": "https://planetarycomputer.microsoft.com/api/stac/v1",
            "usgs_landsat": "https://landsatlook.usgs.gov/stac-server",
            "copernicus_dem_aws": "s3://copernicus-dem-30m/",
            "sentinel2_aws": "s3://sentinel-s2-l2a/",
        },
        "collections": {
            "sentinel-2": ["SENTINEL-2", "sentinel-2-l2a"],
            "sentinel-1": ["SENTINEL-1", "sentinel-1-rtc"],
            "landsat": ["landsat-c2-l2", "landsat-c2-l1"]
        },
        "sample_query": {
            "bbox": [27.01123, -30.677847955, 29.457366138, -28.5705973],
            "datetime": "2024-01-01/2024-12-31",
            "cloud_cover_lt": 20,
            "limit": 10
        },
        "verified": True
    }
    (OUT_DIR / "stac_endpoints.json").write_text(json.dumps(stac_info, indent=2))
    print(f"Saved STAC endpoints to {OUT_DIR / 'stac_endpoints.json'}")
    print("\nTo fetch real imagery, run: python ingestion_planetary_computer.py")
    print("Requires: pip install pystac-client planetary-computer")

if __name__ == "__main__":
    main()
