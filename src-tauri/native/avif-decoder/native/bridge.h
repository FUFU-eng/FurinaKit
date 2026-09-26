#ifndef FURINAKIT_AVIF_BRIDGE_H
#define FURINAKIT_AVIF_BRIDGE_H
#include <stdint.h>
#include <stddef.h>
/* Only our stable PODs cross C/Rust. No handwritten libavif or dav1d struct ABI. */
typedef struct {
    uint8_t *plane[3];
    uint32_t stride[2];
    uint32_t width, height, depth, layout, full_range, primaries, transfer, matrix, chroma;
} FkFrame;
typedef struct {
    uint64_t duration, timescale;
    uint32_t width, height, depth, count, index;
    uint32_t crop_x, crop_y, crop_w, crop_h, rotation;
    int32_t mirror;
    uint32_t primaries, transfer, matrix, alpha, gain_map, pasp_h, pasp_v;
    uint32_t icc_len, exif_len, xmp_len, max_cll, max_pall;
} FkInfo;
void *fk_rav1d_create(uint32_t threads, uint32_t pixels, uint32_t operating_point, uint32_t all_layers);
int fk_rav1d_frame(void *ctx, const uint8_t *data, size_t len, uint32_t spatial_id, FkFrame *out);
void fk_rav1d_destroy(void *ctx);
int fk_cancelled(void);
#endif
