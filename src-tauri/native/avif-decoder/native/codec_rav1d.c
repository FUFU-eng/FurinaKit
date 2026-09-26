/* FurinaKit rav1d adapter. Integration structure follows libavif codec_dav1d.c.
 * Copyright 2019 Joe Drago. All rights reserved. SPDX-License-Identifier: BSD-2-Clause
 * Modifications: stable local POD bridge to Rust-owned rav1d, validated strides,
 * no external dav1d ABI structs/headers; cooperative cancellation between samples.
 */
#include "avif/internal.h"
#include "bridge.h"
#include <string.h>
struct avifCodecInternal { void *context; };
static void destroy(avifCodec *codec) {
    if (codec->internal) { fk_rav1d_destroy(codec->internal->context); avifFree(codec->internal); }
}
static avifBool next(avifCodec *codec, const avifDecodeSample *sample,
                     avifBool alpha, avifBool *limited, avifImage *image) {
    if (fk_cancelled()) return AVIF_FALSE;
    if (!codec->internal->context) {
        codec->internal->context = fk_rav1d_create(AVIF_CLAMP(codec->maxThreads,1,4),
            codec->imageSizeLimit, codec->operatingPoint, codec->allLayers);
        if (!codec->internal->context) return AVIF_FALSE;
    }
    FkFrame f;
    memset(&f,0,sizeof(f));
    if (!fk_rav1d_frame(codec->internal->context, sample->data.data, sample->data.size,
                       sample->spatialID, &f) || fk_cancelled()) return AVIF_FALSE;
    image->width=f.width; image->height=f.height; image->depth=f.depth;
    if (alpha) {
        avifImageFreePlanes(image,AVIF_PLANES_A);
        image->alphaPlane=f.plane[0]; image->alphaRowBytes=f.stride[0];
        image->imageOwnsAlphaPlane=AVIF_FALSE; *limited=!f.full_range;
    } else {
        avifPixelFormat formats[]={AVIF_PIXEL_FORMAT_YUV400,AVIF_PIXEL_FORMAT_YUV420,
                                  AVIF_PIXEL_FORMAT_YUV422,AVIF_PIXEL_FORMAT_YUV444};
        if (f.layout>3) return AVIF_FALSE;
        image->yuvFormat=formats[f.layout]; image->yuvRange=f.full_range?AVIF_RANGE_FULL:AVIF_RANGE_LIMITED;
        image->yuvChromaSamplePosition=(avifChromaSamplePosition)f.chroma;
        image->colorPrimaries=(avifColorPrimaries)f.primaries;
        image->transferCharacteristics=(avifTransferCharacteristics)f.transfer;
        image->matrixCoefficients=(avifMatrixCoefficients)f.matrix;
        avifImageFreePlanes(image,AVIF_PLANES_YUV);
        for (int p=0;p<(f.layout==0?1:3);++p) {
            image->yuvPlanes[p]=f.plane[p]; image->yuvRowBytes[p]=f.stride[p==0?0:1];
        }
        image->imageOwnsYUVPlanes=AVIF_FALSE;
    }
    return AVIF_TRUE;
}
const char *avifCodecVersionDav1d(void) { return "rav1d 1.1.0 (FurinaKit adapter)"; }
avifCodec *avifCodecCreateDav1d(void) {
    avifCodec *c=(avifCodec*)avifAlloc(sizeof(*c)); if (!c) return NULL;
    memset(c,0,sizeof(*c)); c->internal=(struct avifCodecInternal*)avifAlloc(sizeof(*c->internal));
    if (!c->internal) { avifFree(c); return NULL; }
    memset(c->internal,0,sizeof(*c->internal)); c->getNextImage=next; c->destroyInternal=destroy;
    return c;
}
