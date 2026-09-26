# 3. Building and Exporting Datasets

Once your data is labeled and verified, you can compile it into a final YOLO training dataset or export subsets.

## 3.1 Exporting Verified Data

If you only want to work with data that a human has explicitly reviewed (marked as checked: true), use the export tool:

`ash
python main.py export_verified -i data/images -l data/labels -o data/verified_images --out-label data/verified_labels
`

This command queries the dataset.db database and copies/hardlinks the verified files instantly. It does **not** copy the .db file; a new database will be generated in the new folder upon access.

## 3.2 Building the YOLO Dataset

Use uild_dataset to compile your raw JSONs into standard YOLO .txt format and automatically split the dataset (Train, Val, Test).

`ash
python main.py build_dataset --source data/images data/labels --split 80/10/10 --task detect
`

The builder will ensure that classes are perfectly balanced and stratified across the splits.
