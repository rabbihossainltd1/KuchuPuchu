/*
 * KuchuPuchu voice isolation (owner round 32, item 41).
 *
 * A thin, allocation-free-per-call wrapper around RNNoise (Xiph.Org, BSD —
 * see rnnoise/COPYING). The call engine hands every ~10 ms microphone buffer
 * through kp_voice_process() before it reaches the encoder: background noise
 * (fans, traffic, keyboard, wind) is attenuated band by band while the voice
 * bands are left at unity gain, so the far end hears the speaker, not the room.
 *
 * RNNoise works on 480-sample frames at 48 kHz. Phones deliver 48 kHz mic
 * buffers almost universally; for any other rate the chunk is linearly
 * resampled to 48 kHz, cleaned, and resampled back — the chunk boundaries map
 * exactly (first and last sample), so the stream stays click-free.
 */
#ifndef KP_VOICE_H
#define KP_VOICE_H

#ifdef __cplusplus
extern "C" {
#endif

typedef struct KpVoice KpVoice;

/* sample_rate: the microphone rate in Hz. Returns NULL only on allocation failure. */
KpVoice *kp_voice_create(int sample_rate);
void kp_voice_destroy(KpVoice *v);

/*
 * Owner round 34 (item 9): cleaning strength — 0 Normal (a gentle mix
 * that hushes the room), 1 Medium (stronger mix + a soft VAD gate),
 * 2 Aggressive (full RNNoise + the gate down to silence). Safe to call
 * from any thread; the audio thread picks it up on the next chunk.
 */
void kp_voice_set_level(KpVoice *v, int level);

/*
 * Clean one buffer of interleaved 16-bit PCM in place.
 *   frames   samples per channel (a 10 ms buffer: sample_rate / 100)
 *   channels 1 for a phone microphone; more are down-mixed to one voice and
 *            the cleaned signal is written back to every channel
 * Returns 0 when the buffer was processed (and stores the model's speech
 * probability 0..1 in *vad when non-NULL), or -1 when the chunk is not a
 * 10 ms frame at this rate — the buffer is then left untouched.
 */
int kp_voice_process(KpVoice *v, short *pcm, int frames, int channels, float *vad);

#ifdef __cplusplus
}
#endif

#endif
