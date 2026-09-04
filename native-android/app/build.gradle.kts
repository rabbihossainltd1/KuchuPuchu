// Imported, not spelled out: inside a Gradle Kotlin DSL script `java` is the JavaPlugin
// extension accessor, so `java.util.Base64` parses as `project.java.util` and the script
// fails to compile with "Unresolved reference: util". (This is what CI caught.)
import java.util.Base64

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// §51 / Play policy: `release` must not be signed with the repository's debug key —
// that key is in git, so anyone with read access could publish an update that every
// installed phone accepts as coming from this developer. The real signing key lives in
// GitHub Actions secrets (Settings → Secrets and variables → Actions → KP_KEYSTORE_*),
// base64'd, because a keystore that can be committed is a keystore that will be.
//
// Absent secrets (`KP_KEYSTORE_B64` unset: a fork, a fresh clone, a laptop) the release
// build still signs with the debug key — the build must not become unbuildable for
// somebody who has no business holding the signing key. That fallback is loud: the apk
// job prints it, and when the secret IS configured the same job fails the build unless
// the APK's certificate digest is the release one.
val kpKeystoreB64: String? = System.getenv("KP_KEYSTORE_B64")?.takeIf { it.isNotBlank() }
val kpReleaseKeystore: File? = kpKeystoreB64?.let { b64 ->
    val out = layout.buildDirectory.file("keystores/kp-release.keystore").get().asFile
    out.parentFile.mkdirs()
    out.writeBytes(Base64.getMimeDecoder().decode(b64))
    out
}

android {
    namespace = "app.kuchupuchu.android"
    compileSdk = 35
    defaultConfig {
        // Lite-weight APK: WebRTC ships 4 ABIs, phones need 2; only English
        // resources. Cuts several MB and speeds install/startup.
        ndk {
            abiFilters += listOf("arm64-v8a", "armeabi-v7a")
        }
        resourceConfigurations += listOf("en")
        applicationId = "app.kuchupuchu.android"
        minSdk = 24
        targetSdk = 35
        versionCode = 108
        versionName = "3.9.32"
    }
    signingConfigs {
        getByName("debug") {
            storeFile = file("debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
        kpReleaseKeystore?.let { store ->
            create("release") {
                storeFile = store
                // PKCS12 cannot hold a key password that differs from the store
                // password, so both secrets intentionally carry the same value.
                storePassword = System.getenv("KP_STORE_PASSWORD")
                keyAlias = System.getenv("KP_KEY_ALIAS")
                keyPassword = System.getenv("KP_KEY_PASSWORD")
                // minSdk 24 would let AGP drop the JAR signature; keeping v1 on means
                // any tool on a phone (or `keytool -printcert -jarfile`) can read the
                // certificate without needing the SDK's apksigner.
                enableV1Signing = true
                enableV2Signing = true
            }
        }
    }
    buildTypes {
        release {
            // Optimized, installable release APK. Signed with the release key when CI
            // has it, with the debug key otherwise (see kpReleaseKeystore above).
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        // java.time back to API 24. The app has used Instant/Duration/LocalDate since
        // well before this line existed, with minSdk 24 and no desugaring — lint's
        // NewApi check reported 128 findings the first time anyone ran it, i.e. every
        // timestamp in the chat list, the call log, the status list and the clock in
        // the theme was a NoClassDefFoundError on any Android 7.x/8.0 device. The app
        // "worked" only because every phone it was tried on was newer than what the
        // build advertises. D8 compiles the missing APIs into the APK instead; R8
        // shrinking is compatible with it (AGP docs: "only when using the R8 shrinker",
        // which is what release uses here).
        isCoreLibraryDesugaringEnabled = true
    }
    kotlinOptions { jvmTarget = "17" }
    // Unit tests are pure-JVM on purpose: no Robolectric, no android.jar stubs to
    // paper over — if a rule needs a Context it belongs in the device checklist.
    testOptions { unitTests.isIncludeAndroidResources = false }
    buildFeatures { compose = true }
    composeOptions { kotlinCompilerExtensionVersion = "1.5.15" }
    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
        jniLibs.pickFirsts += listOf("**/libc++_shared.so", "**/libjingle_peerconnection_so.so")
    }
    lint {
        // §50: a lint error has to fail CI. Before this, every lint finding was
        // printed and the job stayed green — the gate existed on paper only.
        // Warnings stay warnings (Compose reports a steady stream of
        // "experimental API" notes), and the release lint pass is skipped because
        // CI builds assembleRelease, which is the check that matters there.
        abortOnError = true
        warningsAsErrors = false
        checkReleaseBuilds = false
        textReport = true
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.10.01")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.activity:activity-compose:1.9.3")
    // registerForActivityResult() (photo picker, location attach) needs
    // androidx.fragment >= 1.3.0; Compose pulled 1.5.4 transitively and lint's
    // InvalidFragmentVersionForActivityResult said so. Named explicitly so it is a
    // decision, not an accident of what compose-bom happens to resolve.
    implementation("androidx.fragment:fragment-ktx:1.8.9")
    implementation("androidx.navigation:navigation-compose:2.8.3")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("io.getstream:stream-webrtc-android:1.1.3")
    // Push notifications (Messenger mode). Firebase is initialized at runtime
    // from the worker's /api/config/firebase — no google-services.json needed
    // in the build, so the app works fine before FCM is set up.
    implementation("com.google.firebase:firebase-messaging:24.1.0")
    // Owner round 8 (2026-09-04): SMS OTP test path (Firebase Phone Auth) —
    // TEST ONLY until the owner confirms OTPs actually arrive on his SIMs.
    implementation("com.google.firebase:firebase-auth:23.1.0")
    // Phone auth: Credential Manager + Google ID token (binding & recovery).
    // No google-services.json — the web client id comes from the worker's
    // /api/config/firebase at runtime (same pattern as Firebase init above).
    implementation("androidx.credentials:credentials:1.3.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.3.0")
    implementation("com.google.android.libraries.identity.googleid:googleid:1.1.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("io.coil-kt:coil-compose:2.7.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    // §50's "unit tests" rung: plain JVM tests over the queue's retry clock and the
    // notification id math (app/src/test). JUnit4 because that is what AGP's
    // testDebugUnitTest runs without any further configuration, and pinned like every
    // other dependency here (§51).
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.5")
    testImplementation("junit:junit:4.13.2")
}
