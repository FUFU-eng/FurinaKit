# Native OCR third-party notices

## Deployed model and pipeline baseline

The bundled detection/recognition models are PP-OCRv3 and the direction model is PP-OCRv2, copied without modification from the existing FurinaKit release's rapidocr-onnxruntime 1.2.3 distribution. That distribution declares Apache-2.0 in its METADATA and https://github.com/RapidAI/RapidOCR as its home page. Per-file size and SHA-256 are recorded in models/ocr-v3/manifest.json. No model upgrade is implied.

Sources:
- RapidOCR, SWHL and contributors: https://github.com/RapidAI/RapidOCR
- PaddleOCR / PaddlePaddle: https://github.com/PaddlePaddle/PaddleOCR
- Copyright (c) 2020 PaddlePaddle Authors. All Rights Reserved.
- Apache License 2.0: see ocr-Apache-2.0-LICENSE.txt.

The Rust preprocessing, classification/recognition batching, CTC decoding, DB parameter selection and output formatting are adaptations of the deployed RapidOCR/PaddleOCR algorithms. Changes include Rust/ONNX Runtime integration, bounded memory, cooperative cancellation, verified local model loading, optional DirectML with CPU fallback, and native pixel/geometry operations. Native interpolation, contour geometry and floating-point execution are not claimed to be bit-identical to OpenCV/PyClipper/NumPy.

## Border following

The Suzuki/Abe border-following implementation in src-tauri/src/ocr_geometry.rs is adapted from imageproc 0.25.0:
https://github.com/image-rs/imageproc/blob/v0.25.0/src/contours.rs

Copyright (c) 2015 PistonDevelopers. MIT License; see imageproc-contours-LICENSE.txt.

Changes: specialize to an integer binary map, add a zero border, omit hierarchy metadata (DB needs RETR_LIST), retain up to the baseline's 1000 reverse-discovery candidates, compress collinear steps, add cancellation and complexity limits. No imageproc runtime dependency is introduced.

## Integration

FurinaKit's own task and packaging integration remains under the repository license. Third-party notices and licenses remain applicable to the portions identified above. This file and the license texts must accompany redistribution.
