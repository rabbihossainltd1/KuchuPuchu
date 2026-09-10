/* KuchuPuchu voice isolation — see kp_voice.h. */
#include "kp_voice.h"

#include <stdlib.h>
#include <string.h>

#include "rnnoise.h"

#define KP_RN_RATE 48000
#define KP_RN_FRAME 480 /* rnnoise_get_frame_size() for the built-in model */

struct KpVoice {
    DenoiseState *st;
    int rate;
    int frames10; /* one 10 ms chunk at `rate` */
    /* Mono working buffers: `mono` is the chunk at the microphone rate,
       `in48` / `out48` one RNNoise frame. Sized once in create(). */
    float *mono;
    float in48[KP_RN_FRAME];
    float out48[KP_RN_FRAME];
};

KpVoice *kp_voice_create(int sample_rate) {
    if (sample_rate < 8000 || sample_rate > 192000 || sample_rate % 100 != 0) return NULL;
    KpVoice *v = (KpVoice *)calloc(1, sizeof(KpVoice));
    if (!v) return NULL;
    v->st = rnnoise_create(NULL);
    if (!v->st) {
        free(v);
        return NULL;
    }
    v->rate = sample_rate;
    v->frames10 = sample_rate / 100;
    v->mono = (float *)calloc((size_t)v->frames10, sizeof(float));
    if (!v->mono) {
        rnnoise_destroy(v->st);
        free(v);
        return NULL;
    }
    return v;
}

void kp_voice_destroy(KpVoice *v) {
    if (!v) return;
    if (v->st) rnnoise_destroy(v->st);
    free(v->mono);
    free(v);
}

/*
 * Linear resample of one 10 ms chunk: `n_in` samples in, `n_out` samples out,
 * both spanning the same 10 ms. Output sample i sits at chunk time i / n_out,
 * i.e. at input index i * n_in / n_out — the chunk edges map exactly (index 0
 * to index 0), so consecutive chunks join without a step. The last output
 * sample of a chunk cannot see the next chunk's first sample and holds the
 * last input instead: a sub-sample flattening once per 10 ms, inaudible.
 */
static void kp_resample(const float *in, int n_in, float *out, int n_out) {
    if (n_in == n_out) {
        memcpy(out, in, (size_t)n_in * sizeof(float));
        return;
    }
    int i;
    for (i = 0; i < n_out; i++) {
        double pos = ((double)i * n_in) / n_out;
        int i0 = (int)pos;
        if (i0 > n_in - 1) i0 = n_in - 1;
        int i1 = i0 + 1 < n_in ? i0 + 1 : n_in - 1;
        double frac = pos - i0;
        out[i] = (float)(in[i0] + (in[i1] - in[i0]) * frac);
    }
}

int kp_voice_process(KpVoice *v, short *pcm, int frames, int channels, float *vad) {
    if (!v || !pcm || channels <= 0 || frames != v->frames10) return -1;
    int i, c;
    /* 1. down-mix to one voice, as float in the 16-bit range RNNoise expects */
    for (i = 0; i < frames; i++) {
        int acc = 0;
        for (c = 0; c < channels; c++) acc += pcm[i * channels + c];
        v->mono[i] = (float)acc / (float)channels;
    }
    /* 2. to 48 kHz (a copy at 48 kHz) */
    kp_resample(v->mono, frames, v->in48, KP_RN_FRAME);
    /* 3. the model: per-band gains + pitch filtering, voice bands untouched */
    float p = rnnoise_process_frame(v->st, v->out48, v->in48);
    if (vad) *vad = p;
    /* 4. back to the microphone rate */
    kp_resample(v->out48, KP_RN_FRAME, v->mono, frames);
    /* 5. write the cleaned voice back to every channel, rounded + clamped */
    for (i = 0; i < frames; i++) {
        float s = v->mono[i];
        if (s > 32767.f) s = 32767.f;
        if (s < -32768.f) s = -32768.f;
        short q = (short)(s < 0 ? s - 0.5f : s + 0.5f);
        for (c = 0; c < channels; c++) pcm[i * channels + c] = q;
    }
    return 0;
}
