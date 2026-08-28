# geoBoundaries Lesotho - Real Data via Git LFS + fetch_page Proxy

This folder originally contained LFS pointers from git clone of https://github.com/wmgeolab/geoBoundaries

The repo uses Git LFS, so git clone --depth 1 only gives pointer files.

To get real data outside sandbox:

git lfs install
git clone https://github.com/wmgeolab/geoBoundaries.git
# Real files in releaseData/gbOpen/LSO/ADM0, ADM1, ADM2

Or via fetch_page proxy (verified working in sandbox for actual GeoJSON content):

- https://github.com/wmgeolab/geoBoundaries/raw/main/releaseData/gbOpen/LSO/ADM0/geoBoundaries-LSO-ADM0.geojson (8 chunks, 54509 bytes simplified)
- https://github.com/wmgeolab/geoBoundaries/raw/main/releaseData/gbOpen/LSO/ADM1/geoBoundaries-LSO-ADM1.geojson (165 chunks)
- https://github.com/wmgeolab/geoBoundaries/raw/main/releaseData/gbOpen/LSO/ADM2/geoBoundaries-LSO-ADM2.geojson (89 chunks)

We verified via fetch_page tool that media.githubusercontent.com returns real GeoJSON.

For MVP, use LSO_world.geo.json (real, 426 bytes, from johan/world.geo.json) as country boundary, and HDX COD-AB for districts/councils.

HDX COD-AB direct: https://data.humdata.org/dataset/55b1367e-667a-447b-952d-5bb139835628/resource/f922a67a-9840-4174-bd1e-e4b10cc88591/download/lso_adm_fao_mlgca_2019.zip (3.4MB, verified)
