plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
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
        versionCode = 46
        versionName = "3.8.0"
    }
    signingConfigs {
        getByName("debug") {
            storeFile = file("debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }
    buildTypes {
        release {
            // Optimized, installable release APK — signed with the repo's
            // debug key so it installs directly (personal distribution).
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            signingConfig = signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { compose = true }
    composeOptions { kotlinCompilerExtensionVersion = "1.5.15" }
    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
        jniLibs.pickFirsts += listOf("**/libc++_shared.so", "**/libjingle_peerconnection_so.so")
    }
    lint { abortOnError = false }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.10.01")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.navigation:navigation-compose:2.8.3")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("io.getstream:stream-webrtc-android:1.1.3")
    // Push notifications (Messenger mode). Firebase is initialized at runtime
    // from the worker's /api/config/firebase — no google-services.json needed
    // in the build, so the app works fine before FCM is set up.
    implementation("com.google.firebase:firebase-messaging:24.1.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("io.coil-kt:coil-compose:2.7.0")
    // Splash animation (Lottie JSON in res/raw)
    implementation("com.airbnb.android:lottie-compose:6.4.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
}
