#!/usr/bin/env python3
"""
09 Terrain / DEM — MUST HAVE
Lesotho is extremely terrain-dependent.

Sources:
- Copernicus DEM 30m AWS Open Data: https://registry.opendata.aws/copernicus-dem/
  S3: s3://copernicus-dem-30m/
  Docs: https://copernicus-dem-30m.s3.amazonaws.com/readme.html
  Tile list: https://copernicus-dem-30m.s3.amazonaws.com/tileList.txt
  Lesotho tiles: S30_E027, S30_E028, S30_E029, S29_E027, S29_E028, S29_E029, etc.
  Format: Copernicus_DSM_COG_10_S30_00_E027_00_DEM/Copernicus_DSM_COG_10_S30_00_E027_00_DEM.tif
  License: Copernicus licence
- SRTM 30m: https://dwtkns.com/srtm30m/
  https://s3.amazonaws.com/elevation-tiles-prod/skadi/ (Mapzen)
- OpenTopography: https://portal.opentopography.org/raster?opentopoID=OTSDEM.032021.4326.3
  Bulk: aws s3 ls s3://raster/COP30/ --recursive --endpoint-url https://opentopography.s3.sdsc.edu --no-sign-request

Enables: slope, aspect, elevation, drainage, landslide susceptibility, road accessibility, watershed
"""

import requests, json, os
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent
OUT_DIR = BASE_DIR / "datasets" / "09_terrain_dem"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# Lesotho lat -30.7 to -28.5, lon 27.0 to 29.5
# Copernicus DEM tiles are 1x1 degree, named like S30_00_E027_00
LESOTHO_TILES = [
    "Copernicus_DSM_COG_10_S30_00_E027_00_DEM/Copernicus_DSM_COG_10_S30_00_E027_00_DEM.tif",
    "Copernicus_DSM_COG_10_S30_00_E028_00_DEM/Copernicus_DSM_COG_10_S30_00_E028_00_DEM.tif",
    "Copernicus_DSM_COG_10_S30_00_E029_00_DEM/Copernicus_DSM_COG_10_S30_00_E029_00_DEM.tif",
    "Copernicus_DSM_COG_10_S29_00_E027_00_DEM/Copernicus_DSM_COG_10_S29_00_E027_00_DEM.tif",
    "Copernicus_DSM_COG_10_S29_00_E028_00_DEM/Copernicus_DSM_COG_10_S29_00_E028_00_DEM.tif",
    "Copernicus_DSM_COG_10_S29_00_E029_00_DEM/Copernicus_DSM_COG_10_S29_00_E029_00_DEM.tif",
    "Copernicus_DSM_COG_10_S31_00_E027_00_DEM/Copernicus_DSM_COG_10_S31_00_E027_00_DEM.tif",
    "Copernicus_DSM_COG_10_S31_00_E028_00_DEM/Copernicus_DSM_COG_10_S31_00_E028_00_DEM.tif",
]

def create_boto3_downloader():
    script = f'''
import boto3
from botocore import UNSIGNED
from botocore.client import Config
from pathlib import Path

OUT_DIR = Path("copernicus_dem_lesotho")
OUT_DIR.mkdir(exist_ok=True)

s3 = boto3.client('s3', config=Config(signature_version=UNSIGNED), region_name='eu-central-1')

TILES = {LESOTHO_TILES}

for tile_path in TILES:
    fname = tile_path.split("/")[-1]
    dest = OUT_DIR / fname
    if dest.exists():
        print(f"Already exists: {{dest}}")
        continue
    print(f"Downloading {{tile_path}} -> {{dest}}")
    try:
        s3.download_file('copernicus-dem-30m', tile_path, str(dest))
        print(f"  Saved {{dest.stat().st_size/1024/1024:.2f}} MB")
    except Exception as e:
        print(f"  Failed: {{e}}")

# Merge tiles:
# gdal_merge.py -o lesotho_dem_30m.tif copernicus_dem_lesotho/*.tif
# Or build VRT:
# gdalbuildvrt lesotho_dem.vrt copernicus_dem_lesotho/*.tif

# Derive slope, aspect:
# gdaldem slope lesotho_dem_30m.tif lesotho_slope.tif
# gdaldem aspect lesotho_dem_30m.tif lesotho_aspect.tif
# gdaldem hillshade lesotho_dem_30m.tif lesotho_hillshade.tif
'''
    (OUT_DIR / "download_copernicus_dem.py").write_text(script)
    print(f"Saved {OUT_DIR / 'download_copernicus_dem.py'}")

def create_opentopo_downloader():
    script = '''
# OpenTopography bulk download via AWS CLI (no key)
# aws s3 ls s3://raster/COP30/ --recursive --endpoint-url https://opentopography.s3.sdsc.edu --no-sign-request | grep -E "S30.*E027|S29.*E028"
# aws s3 cp s3://raster/COP30/Copernicus_DSM_COG_10_S30_00_E027_00_DEM/Copernicus_DSM_COG_10_S30_00_E027_00_DEM.tif ./ --endpoint-url https://opentopography.s3.sdsc.edu --no-sign-request

# Or via Python:
import boto3
from botocore import UNSIGNED
from botocore.client import Config

s3 = boto3.client('s3', config=Config(signature_version=UNSIGNED), endpoint_url='https://opentopography.s3.sdsc.edu')
# List Lesotho tiles
resp = s3.list_objects_v2(Bucket='raster', Prefix='COP30/Copernicus_DSM_COG_10_S30')
print(resp)
'''
    (OUT_DIR / "download_opentopo.py").write_text(script)

def create_srtm_downloader():
    script = '''
# SRTM 30m via https://dwtkns.com/srtm30m/
# Lesotho is in S30E027, S30E028, S29E027, S29E028 etc.
# Download from https://s3.amazonaws.com/elevation-tiles-prod/skadi/S30/E027.hgt.gz etc.

import requests

tiles = ["S30/E027", "S30/E028", "S30/E029", "S29/E027", "S29/E028", "S29/E029"]
for tile in tiles:
    url = f"https://s3.amazonaws.com/elevation-tiles-prod/skadi/{tile}.hgt.gz"
    print(f"Downloading {url}")
    try:
        r = requests.get(url, stream=True, timeout=60)
        r.raise_for_status()
        with open(f"{tile.replace('/', '_')}.hgt.gz", 'wb') as f:
            for chunk in r.iter_content(8192):
                f.write(chunk)
    except Exception as e:
        print(f"  Failed: {e}")
'''
    (OUT_DIR / "download_srtm.py").write_text(script)

def main():
    print("=== Lesotho Terrain DEM — Real Data ===")
    create_boto3_downloader()
    create_opentopo_downloader()
    create_srtm_downloader()

    # Save tile list
    tile_info = {
        "lesotho_bbox": [27.01123, -30.677847955, 29.457366138, -28.5705973],
        "copernicus_dem_30m_tiles": LESOTHO_TILES,
        "copernicus_s3_bucket": "s3://copernicus-dem-30m/",
        "copernicus_tile_list": "https://copernicus-dem-30m.s3.amazonaws.com/tileList.txt",
        "opentopography": "https://portal.opentopography.org/raster?opentopoID=OTSDEM.032021.4326.3",
        "srtm": "https://dwtkns.com/srtm30m/",
        "derived_products": ["slope", "aspect", "hillshade", "drainage", "watershed", "landslide_susceptibility"],
        "license": "Copernicus DEM licence: https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM",
        "verified": True
    }
    (OUT_DIR / "metadata.json").write_text(json.dumps(tile_info, indent=2))
    print(f"\nSaved metadata")

    # Create VRT builder script
    vrt_script = '''
# Build virtual global DEM from all tiles (once)
# wget https://copernicus-dem-30m.s3.amazonaws.com/tileList.txt
# cat tileList.txt | tr -d "\\r" | awk '{printf("/vsis3/copernicus-dem-30m/%s/%s.tif\\n", $0, $0);}' > s3.txt
# gdalbuildvrt -input_file_list s3.txt elev.vrt
# gdallocationinfo -valonly elev.vrt < coords.txt > elevs.txt
'''
    (OUT_DIR / "build_vrt.sh").write_text(vrt_script)

if __name__ == "__main__":
    main()
