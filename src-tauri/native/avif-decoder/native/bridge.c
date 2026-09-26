/* Project-owned bounded libavif interface. Upstream structs never cross the ABI. */
#include "avif/avif.h"
#include "bridge.h"
#include <stdio.h>
#include <string.h>
#define MAX_METADATA (4u*1024u*1024u)
static int result(avifDecoder *d, avifResult r, char *error, size_t n) {
    if (r==AVIF_RESULT_OK && !fk_cancelled()) return 1;
    if (fk_cancelled()) snprintf(error,n,"AVIF cancelled");
    else snprintf(error,n,"libavif: %s (%s)",avifResultToString(r),d->diag.error);
    return 0;
}
void *fk_avif_open(const uint8_t *bytes, size_t len, char *error, size_t n) {
    if (!bytes || !len || len>128u*1024u*1024u || fk_cancelled()) {
        snprintf(error,n,"AVIF empty/oversized input or cancelled"); return NULL;
    }
    avifDecoder *d=avifDecoderCreate();
    if (!d) { snprintf(error,n,"AVIF allocation failed"); return NULL; }
    d->codecChoice=AVIF_CODEC_CHOICE_DAV1D; d->maxThreads=4;
    d->imageSizeLimit=40000000; d->imageDimensionLimit=40000; d->imageCountLimit=10000;
    d->strictFlags=AVIF_STRICT_ENABLED;
    d->imageContentToDecode=AVIF_IMAGE_CONTENT_COLOR_AND_ALPHA|AVIF_IMAGE_CONTENT_SAMPLE_TRANSFORMS;
    avifResult r=avifDecoderSetIOMemory(d,bytes,len);
    if (r==AVIF_RESULT_OK) r=avifDecoderParse(d);
    if (!result(d,r,error,n)) { avifDecoderDestroy(d); return NULL; }
    return d;
}
void fk_avif_close(void *p) { if (p) avifDecoderDestroy((avifDecoder*)p); }
int fk_avif_decode(void *p, uint32_t index, char *error, size_t n) {
    avifDecoder *d=(avifDecoder*)p;
    if (index >= (uint32_t)d->imageCount || fk_cancelled()) {
        snprintf(error,n,"AVIF frame index outside sequence or cancelled"); return 0;
    }
    return result(d,avifDecoderNthImage(d,index),error,n);
}
int fk_avif_info(void *p, FkInfo *v, char *error, size_t n) {
    avifDecoder *d=(avifDecoder*)p; const avifImage *im=d->image;
    if (!im || im->icc.size>MAX_METADATA || im->exif.size>MAX_METADATA || im->xmp.size>MAX_METADATA) {
        snprintf(error,n,"AVIF metadata budget exceeded"); return 0;
    }
    memset(v,0,sizeof(*v)); v->width=im->width; v->height=im->height; v->depth=im->depth;
    v->count=(uint32_t)d->imageCount; v->index=d->imageIndex<0?0:(uint32_t)d->imageIndex;
    v->duration=d->imageTiming.durationInTimescales; v->timescale=d->imageTiming.timescale;
    avifCropRect crop={0,0,im->width,im->height};
    if ((im->transformFlags&AVIF_TRANSFORM_CLAP) &&
        !avifCropRectFromCleanApertureBox(&crop,&im->clap,im->width,im->height,&d->diag)) {
        snprintf(error,n,"AVIF invalid clean aperture: %s",d->diag.error); return 0;
    }
    v->crop_x=crop.x; v->crop_y=crop.y; v->crop_w=crop.width; v->crop_h=crop.height;
    v->rotation=(im->transformFlags&AVIF_TRANSFORM_IROT)?im->irot.angle:0;
    v->mirror=(im->transformFlags&AVIF_TRANSFORM_IMIR)?im->imir.axis:-1;
    v->pasp_h=(im->transformFlags&AVIF_TRANSFORM_PASP)?im->pasp.hSpacing:1;
    v->pasp_v=(im->transformFlags&AVIF_TRANSFORM_PASP)?im->pasp.vSpacing:1;
    v->primaries=im->colorPrimaries; v->transfer=im->transferCharacteristics; v->matrix=im->matrixCoefficients;
    v->alpha=d->alphaPresent; v->gain_map=(im->gainMap!=NULL);
    v->icc_len=(uint32_t)im->icc.size; v->exif_len=(uint32_t)im->exif.size; v->xmp_len=(uint32_t)im->xmp.size;
    v->max_cll=im->clli.maxCLL; v->max_pall=im->clli.maxPALL;
    return 1;
}
int fk_avif_rgba(void *p, void *pixels, size_t len, uint32_t depth, char *error, size_t n) {
    avifDecoder *d=(avifDecoder*)p; const avifImage *im=d->image;
    uint64_t required=(uint64_t)im->width*im->height*4u*(depth==16?2u:1u);
    if (!pixels || (depth!=8 && depth!=16) || required!=len || required>256000000u || fk_cancelled()) {
        snprintf(error,n,"AVIF invalid RGB output budget or cancelled"); return 0;
    }
    avifRGBImage rgb; avifRGBImageSetDefaults(&rgb,im);
    rgb.depth=depth; rgb.format=AVIF_RGB_FORMAT_RGBA; rgb.alphaPremultiplied=AVIF_FALSE;
    rgb.pixels=(uint8_t*)pixels; rgb.rowBytes=im->width*4u*(depth==16?2u:1u);
    rgb.maxThreads=4;
    /* libavif performs matrix/range/chroma/bit-depth conversion and unpremultiplication.
       ICC/primaries/transfer are separately retained, NOT relabelled as sRGB. */
    return result(d,avifImageYUVToRGB(im,&rgb),error,n);
}
int fk_avif_metadata(void *p, uint32_t which, uint8_t *out, size_t len) {
    const avifImage *im=((avifDecoder*)p)->image;
    const avifRWData *data=which==0?&im->icc:(which==1?&im->exif:&im->xmp);
    if (which>2 || len!=data->size || len>MAX_METADATA) return 0;
    if (len) { if (!out || !data->data) return 0; memcpy(out,data->data,len); }
    return 1;
}
size_t fk_avif_info_size(void) { return sizeof(FkInfo); }
size_t fk_avif_frame_size(void) { return sizeof(FkFrame); }
int fk_avif_is_avif(const uint8_t *p,size_t n) { avifROData d={p,n}; return p && n && avifPeekCompatibleFileType(&d); }
