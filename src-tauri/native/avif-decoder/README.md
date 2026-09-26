# FurinaKit native AVIF decoder — G02 isolated baseline

This unpublished Rust library is not yet connected to the Tauri application.

## Architecture

- Pinned libavif 1.4.2 C container/grid/auxiliary-alpha/sequence/sample-transform handling and YUV→RGB conversion.
- Pinned rav1d 1.1.0, 8/16-bit support, assembler disabled by default. Optional `av1-asm` requires a separately provisioned assembler; nothing installs it automatically.
- Project-owned C/Rust POD boundary. Upstream C layouts remain in C; rav1d context/data/picture types remain in Rust. No bindgen or handwritten upstream struct ABI.
- Upstream sources are unmodified. `build.rs` mirrors the relevant CMake source list, including the bundled libyuv C scaling fallback. Full external libyuv, CMake and runtime Python are not required.
- The codec adapter follows libavif's BSD-licensed dav1d adapter. Pictures/data/contexts are owned by Rust guards, with bounded send/get/drain and spatial-layer selection. libavif handles alpha sizing/depth validation/resampling; it is not bypassed by the adapter.

## API and boundaries

`decode(bytes, frame_index, &AtomicBool)` returns cropped/CCW-rotated/mirrored, straight-alpha RGBA8 or full-range RGBA16, source colour metadata, sequence timing and source Exif/XMP. High-bit-depth samples are not silently reduced to 8 bits. Source Exif must not be blindly reinserted after applying container geometry.

**RGBA is in the source colour encoding, not necessarily sRGB.** libavif handles YUV matrix/range/chroma conversion, not ICC colour management, primaries/transfer conversion or HDR tone mapping. Gain-map presence is surfaced; its pixels are not decoded/applied. Non-square pixel aspect is surfaced, not resampled. Production decisions for these cases and Exif orientation remain open.

Input ≤128 MiB; source ≤40M pixels / 40k per axis; ≤10k frames; ≤4 decoder threads; each ICC/Exif/XMP ≤4 MiB; each RGBA allocation ≤256,000,000 bytes. These are NOT a process working-set limit: native parser/codec/grid allocations and simultaneous geometry buffers still exist; metadata limits are checked after libavif parsing. Cancellation is cooperative between calls/samples and geometry rows, not an interrupt of a running AV1 worker or reformat kernel. Pre-cancel/restart was tested; in-flight cancellation and process isolation are not accepted yet. `panic=abort` is not crash isolation.

## Development evidence

Project-local evidence: `_verify/native-shrink/avif-g02-20260920/`.

The final development run passed 2 unit tests and 13 integration tests using public libavif fixtures, PNG-derived references and documented fixture derivatives. Coverage includes grid+separate alpha, sequences/random access, ICC/Exif/XMP, 8/10/12/16-bit paths, crop/rotation/mirror, malformed/truncated inputs, pre-cancel/restart and independent concurrent contexts. This is neither fuzzing nor an exhaustive AVIF conformance/performance suite.

The 10-bit combined-transform case has exact 16-bit geometry equality against identical coded samples with transforms disabled. Its independent Pillow RGBA8 comparison differs by up to 2 levels across the different output/reformat paths; cross-backend bit-exactness is not claimed. Earlier failures and corrected test assumptions remain in the evidence logs.

Tests require an explicit `FURINAKIT_AVIF_FIXTURES` directory containing the recorded fixtures and derived reference files. Do not rerun one-shot import/capture scripts after their output exists. Consult `docs/mcp-native-avif-g02.md` and the current handoff before any recovery/build.

## Licensing / provenance

- `vendor/libavif/LICENSE`: preserve the complete upstream composite notice, including BSD libavif/dav1d-OBU/libyuv sections. Unused third-party notices are retained rather than deleting portions of the original license.
- `vendor/libavif/third_party/libyuv/AUTHORS` and original per-source headers are retained.
- `licenses/rav1d-COPYING.txt`: original rav1d BSD notice.
- Archive URL/tag/hash and every imported source/fixture hash are recorded in `source-provenance.json` and `fallback-provenance.json` under the evidence directory. `Cargo.lock` pins registry checksums.
- The prior MPL-2.0 parser probe is not a dependency of this crate; its historical artifacts and obligations must still be preserved wherever redistributed.
- Final application license aggregation/packaging, libwebp and rav1e patent/composite notices remain separate unfinished production work.

No installer, public release, installed-footprint measurement or real-old-version update acceptance is provided by this library baseline.
