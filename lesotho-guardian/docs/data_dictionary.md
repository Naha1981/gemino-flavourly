# Lesotho Guardian — Data Dictionary (Verified Sources)

## 01 Administrative Boundaries

| Field | Type | Description | Source |
|-------|------|-------------|--------|
| ADM0 | Polygon | Lesotho country boundary | HDX COD-AB FAO/MLGCA 2019, geoBoundaries LSO-ADM0, Natural Earth, world.geo.json |
| ADM1 | Polygon | 10 districts | Same + DRWS official service |
| ADM2 | Polygon | 78 community councils (64 community + 11 urban + 1 municipal, with 2 spanning districts) | FAO/MLGCA |
| BBox | BBox | 27.01123,-30.67785,29.45737,-28.57060 | HDX |
| P-codes | TEXT | LS-A to LS-J alphabetical (unusual) | FAO/MLGCA |

**10 Districts**: Berea, Butha-Buthe, Leribe, Mafeteng, Maseru, Mohale's Hoek, Mokhotlong, Qacha's Nek, Quthing, Thaba-Tseka

**Verification**: Must have 10 ADM1 features, 78 ADM2.

## 02 Roads & Transport

| Field | Type | Description |
|-------|------|-------------|
| highway | TEXT | motorway, trunk, primary, secondary, tertiary, residential, track, footway, path |
| bridge | BOOL | yes if bridge |
| surface | TEXT | paved, unpaved, gravel |
| name | TEXT | road name |
| osm_id | BIGINT | OSM ID |

**Sources**: Geofabrik PBF 119MB, HOTOSM GPKG 34MB
**License**: ODbL

## 03 Settlements & Buildings

| Field | Type | Description |
|-------|------|-------------|
| place | TEXT | city, town, village, hamlet |
| building | TEXT | yes, residential, commercial, etc. |
| name | TEXT | settlement/building name |
| area | FLOAT | building footprint area m2 |

**Sources**: HOTOSM Buildings, Microsoft GlobalML (quadkeys), Google Open Buildings (S2 cells)
**Use**: Exposure analysis

## 04 Population

| Field | Type | Description |
|-------|------|-------------|
| population | INT | people per pixel (100m) or per H3 hex (400m) |
| density | FLOAT | people per km2 |

**Sources**: WorldPop Constrained 100m (1.90MB GeoTIFF, CC BY 4.0), Kontur H3 400m
**DOI**: 10.5258/SOTON/WP00683
**Method**: Random Forests dasymetric redistribution, building footprints Ecopia AI/Maxar 2020

## 05 Satellite Imagery

| Field | Type | Description |
|-------|------|-------------|
| collection | TEXT | sentinel-2-l2a, sentinel-1-rtc, landsat-c2-l2 |
| datetime | TIMESTAMPTZ | acquisition time |
| cloud_cover | FLOAT | % |
| bbox | POLYGON | scene bbox |
| s3_url | TEXT | AWS S3 path |

**Sources**: Copernicus Dataspace STAC, Planetary Computer STAC, USGS Landsat STAC
**Lesotho BBox**: 27.01,-30.68,29.46,-28.57
**SAR**: Sentinel-1 works through clouds/night for flooding

## 06 Fire Data

| Field | Type | Description |
|-------|------|-------------|
| latitude | FLOAT | |
| longitude | FLOAT | |
| bright_ti4 | FLOAT | brightness temp band I4 |
| acq_date | DATE | |
| acq_time | TEXT | |
| satellite | TEXT | N (SNPP), N20, N21, Terra, Aqua |
| instrument | TEXT | VIIRS, MODIS |
| confidence | TEXT | l, n, h (low, nominal, high) |
| frp | FLOAT | fire radiative power |
| daynight | TEXT | D/N |

**Source**: NASA FIRMS, latency 3h global, 60s US/Canada
**API**: https://firms.modaps.eosdis.nasa.gov/api/area/csv/MAP_KEY/VIIRS_SNPP_NRT/27.01,-30.68,29.46,-28.57/1
**MAP_KEY**: free from https://firms.modaps.eosdis.nasa.gov/api/map_key/ (Earthdata Login)

## 07 Weather & Rainfall

| Field | Type | Description |
|-------|------|-------------|
| date | DATE | |
| temp_max | FLOAT | °C |
| temp_min | FLOAT | °C |
| precip_sum | FLOAT | mm |
| wind_max | FLOAT | km/h |
| source | TEXT | open-meteo, chirps, era5 |

**Sources**:
- CHIRPS: 0.05° daily 1981-present, https://data.chc.ucsb.edu/products/CHIRPS-2.0/africa_daily/tifs/
- ERA5: 0.25° hourly, https://cds.climate.copernicus.eu/datasets/reanalysis-era5-single-levels
- Open-Meteo: free, no key, https://archive-api.open-meteo.com/v1/archive?latitude=-29.3167&longitude=27.4833&start_date=2023-01-01&end_date=2023-01-10&daily=temperature_2m_max,temperature_2m_min,precipitation_sum

**Real Sample**: Maseru 2023-01-01 to 2023-01-10 fetched via fetch_page proxy: temps 24.1,24.7°C, precip 0.2,1.4,6.3mm etc. Elevation 1546m.

## 08 Hydrology

| Field | Type | Description |
|-------|------|-------------|
| length_km | FLOAT | river reach length |
| dis_m3_psec | FLOAT | discharge |
| strahler | INT | Strahler order |
| lake_area | FLOAT | lake area km2 |
| hybas_id | BIGINT | HydroBASINS ID |

**Sources**:
- HydroRIVERS Africa SHP 108MB: https://data.hydrosheds.org/file/hydrorivers/HydroRIVERS_v10_af_shp.zip
- HydroLAKES: https://data.hydrosheds.org/file/hydrolakes/HydroLAKES_polys_v10_shp.zip
- HOTOSM Waterways: https://data.humdata.org/dataset/hotosm_lso_waterways
- Natural Earth: ne_10m_rivers_lake_centerlines, ne_10m_lakes

**Risk Logic**: Heavy rainfall + River proximity (500m buffer) + Elevation → Flood risk

## 09 Terrain / DEM

| Field | Type | Description |
|-------|------|-------------|
| elevation | FLOAT | m |
| slope | FLOAT | degrees |
| aspect | FLOAT | degrees |
| hillshade | FLOAT | |

**Sources**:
- Copernicus DEM 30m: s3://copernicus-dem-30m/, https://registry.opendata.aws/copernicus-dem/
  Tiles: S30_E027, S30_E028, S30_E029, S29_E027, S29_E028, S29_E029
- SRTM 30m: https://dwtkns.com/srtm30m/
- OpenTopography: https://portal.opentopography.org/raster?opentopoID=OTSDEM.032021.4326.3

**Lesotho**: extremely terrain-dependent, elevation 1400-3400m, enables landslide susceptibility, road accessibility, watershed analysis.

## 10 Critical Infrastructure

| Field | Type | Description |
|-------|------|-------------|
| type | TEXT | hospital, clinic, school, police, fire_station, airport, dam, power, telecom, bridge, water |
| amenity | TEXT | OSM amenity tag |
| name | TEXT | facility name |
| capacity | INT | persons |
| healthcare | TEXT | hospital, clinic, etc. |

**Sources**:
- HOTOSM Health: https://data.humdata.org/dataset/hotosm_lso_health_facilities (7.2KB GPKG)
- HOTOSM Education: https://data.humdata.org/dataset/hotosm_lso_education_facilities
- HOTOSM Airports: https://data.humdata.org/dataset/hotosm_lso_airports
- Healthsites: https://data.humdata.org/dataset/lesotho-healthsites
- Overpass API: https://overpass-api.de/api/interpreter

**Note**: Government-owned datasets should eventually replace/augment OSM via official agreement. Gov portal: https://www.gov.ls/eservice/data-management-vegetation-geospatial-and-user-data/

---

## Sensitive Data (NOT Included, Requires Official Agreement)

- Police incidents, crime reports, emergency calls, missing persons, stolen vehicles, patrol reports, case outcomes (LMPS)
- Border infrastructure, official facilities, approved operational reports, emergency deployments (LDF)
- CCTV, drone feeds (authorized sources only)

**Don't scrape or invent these.** Come via authorized integration/data-sharing agreement.

---

## Verification

All datasets have:
- Direct URL from official source
- License documented
- Verification in scripts/verify_datasets.py
- Real sample where proxy allowed (LSO_world.geo.json, weather JSON)

Run: `python scripts/verify_datasets.py`
