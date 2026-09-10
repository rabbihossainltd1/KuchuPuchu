# KuchuPuchu native audio (owner round 32, item 41): RNNoise-based voice
# isolation for calls. One small shared library, C only, no STL — it links
# against nothing but libm and the JNI headers the NDK provides.
cmake_minimum_required(VERSION 3.18.1)
project(kp_voice C)

# gnu99 (not strict c99): the Opus arch header wants M_PI. No -ffast-math on
# purpose — that header refuses it (NaN input could crash the audio thread);
# -O3 alone keeps the model well under a millisecond per 10 ms frame.
set(CMAKE_C_STANDARD 99)
set(CMAKE_C_EXTENSIONS ON)
set(CMAKE_C_FLAGS_RELEASE "-O3 -DNDEBUG -fvisibility=hidden")
set(CMAKE_C_FLAGS_DEBUG "-O2 -fvisibility=hidden")
set(CMAKE_C_FLAGS_RELWITHDEBINFO "-O3 -DNDEBUG -fvisibility=hidden")

add_library(
    kp_voice SHARED
    kp_voice.c
    kp_voice_jni.c
    rnnoise/src/denoise.c
    rnnoise/src/kiss_fft.c
    rnnoise/src/pitch.c
    rnnoise/src/celt_lpc.c
    rnnoise/src/rnn.c
    rnnoise/src/rnn_data.c
)

target_include_directories(kp_voice PRIVATE rnnoise/include rnnoise/src)
# The bundled RNNoise is built as a static part of this library: RNNOISE_BUILD
# marks its symbols default-visibility inside the object (the JNI entry points
# carry JNIEXPORT), and the file-mode model loader is not compiled in.
target_compile_definitions(kp_voice PRIVATE RNNOISE_BUILD=1 TRAINING=0)
target_compile_options(kp_voice PRIVATE -Wall -Wno-unused-parameter -Wno-unused-function)

target_link_libraries(kp_voice m)
