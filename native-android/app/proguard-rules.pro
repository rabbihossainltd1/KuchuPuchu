# ---- KuchuPuchu release keep rules ----

# WebRTC: heavy JNI + reflection — keep the whole package.
-keep class org.webrtc.** { *; }
-dontwarn org.webrtc.**

# Firebase messaging (service is kept via manifest rules already).
-keep class com.google.firebase.** { *; }
-dontwarn com.google.android.gms.**

# Coroutines internals are safe, silence optional warnings.
-dontwarn kotlinx.coroutines.**

# Keep our data models' names for readable crash logs.
-keepnames class app.kuchupuchu.android.** { *; }
