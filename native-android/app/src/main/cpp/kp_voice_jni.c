/*
 * JNI bridge for app.kuchupuchu.android.VoiceIsolation (owner round 32, item 41).
 *
 * The Kotlin side owns a direct ByteBuffer for each microphone chunk (WebRTC's
 * own capture buffer), so processing is in place with no copy across the
 * boundary: one JNI call per 10 ms.
 */
#include <jni.h>
#include <stddef.h>
#include <stdint.h>

#include "kp_voice.h"

JNIEXPORT jlong JNICALL
Java_app_kuchupuchu_android_VoiceIsolation_nativeCreate(JNIEnv *env, jclass cls, jint sampleRate) {
    (void)env;
    (void)cls;
    return (jlong)(intptr_t)kp_voice_create((int)sampleRate);
}

JNIEXPORT void JNICALL
Java_app_kuchupuchu_android_VoiceIsolation_nativeDestroy(JNIEnv *env, jclass cls, jlong handle) {
    (void)env;
    (void)cls;
    kp_voice_destroy((KpVoice *)(intptr_t)handle);
}

/* Returns the speech probability (0..1) for the chunk, or -1 when it was left untouched. */
JNIEXPORT jfloat JNICALL
Java_app_kuchupuchu_android_VoiceIsolation_nativeProcess(
    JNIEnv *env, jclass cls, jlong handle, jobject buffer, jint frames, jint channels) {
    (void)cls;
    KpVoice *v = (KpVoice *)(intptr_t)handle;
    if (!v || !buffer) return -1.f;
    short *pcm = (short *)(*env)->GetDirectBufferAddress(env, buffer);
    if (!pcm) return -1.f;
    jlong cap = (*env)->GetDirectBufferCapacity(env, buffer);
    if (cap < (jlong)frames * channels * 2) return -1.f;
    float vad = 0.f;
    if (kp_voice_process(v, pcm, (int)frames, (int)channels, &vad) != 0) return -1.f;
    return (jfloat)vad;
}
