fn main() {
    // Pinned upstream source, imported with archive + per-file SHA256 provenance.
    // No CMake, bindgen, Python or external executable is needed at application runtime.
    let root = "vendor/libavif";
    let mut b = cc::Build::new();
    b.include(format!("{root}/include")).include(format!("{root}/third_party/libyuv/include"))
        .include("native").std("c11")
        .define("AVIF_CODEC_DAV1D", None).define("AVIF_STATIC", None)
        .define("_CRT_SECURE_NO_WARNINGS", None);
    // Match upstream Release semantics: AVIF_ASSERT_OR_RETURN returns errors, not assert-abort.
    if std::env::var("PROFILE").as_deref()==Ok("release") { b.define("NDEBUG", None); }
    for name in ["alpha", "avif", "colr", "colrconvert", "diag", "exif", "gainmap", "io",
        "mem", "obu", "properties", "rawdata", "read", "reformat", "reformat_libsharpyuv",
        "reformat_libyuv", "sampletransform", "scale", "stream", "utils", "write"] {
        b.file(format!("{root}/src/{name}.c"));
    }
    // Upstream CMake uses this bundled C fallback even with full libyuv disabled.
    for name in ["scale", "scale_common", "scale_any", "row_common", "planar_functions"] {
        b.file(format!("{root}/third_party/libyuv/source/{name}.c"));
    }
    b.file("native/codec_rav1d.c").file("native/bridge.c").compile("furinakit_avif");
    println!("cargo:rerun-if-changed=vendor/libavif");
    println!("cargo:rerun-if-changed=native");
}
