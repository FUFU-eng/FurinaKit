# Image worker dependency notices and source

Upstream packages without bundled notices are supplemented from their exact recorded VCS commits; simd_helpers declares MIT but ships no license file even in that commit, so its original manifest plus explicitly distributor-supplied standard MIT text and attribution are included (not represented as an upstream file).

Original complete license, notice and patent files are preserved recursively per package. Manifest records the resolved graph, features and archive/notice SHA-256 values, including build-only dependencies (not all are runtime-linked). License expressions remain upstream expressions; preserving multiple alternatives does not relicense dependencies.

rav1d 1.1.0 is MPL-2.0. Its unmodified, checksum-verified corresponding source is provided in sources/rav1d-1.1.0.crate (gzip tar). It is also available at https://static.crates.io/crates/rav1d/rav1d-1.1.0.crate . FurinaKit makes no modifications to that crate. Extract the archive with any tar/gzip utility; its Cargo.toml and original source/build files are included. Project container adapter integration is separate.

libavif 1.4.2 composite license is retained under avif-container-adapter; libwebp and rav1e patent grants and third-party subcomponent notices are retained in their complete package notice directories. No patent freedom-to-operate claim is made.

The installed location is licenses/project-dependencies/image-codecs-g03.
