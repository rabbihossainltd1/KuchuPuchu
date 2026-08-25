import { initializeApp } from "firebase/app";
import { getAuth, setPersistence, browserLocalPersistence } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyCNciMLD8itdh73PDRq-nNT71qpPyjRUeI",
  authDomain: "kuchupuchuff2026.firebaseapp.com",
  projectId: "kuchupuchuff2026",
  storageBucket: "kuchupuchuff2026.firebasestorage.app",
  messagingSenderId: "458576897499",
  appId: "1:458576897499:web:06df74e3c2ee9eb07d33fe",
};

const app = initializeApp(firebaseConfig);
export const firebaseAuth = getAuth(app);

void setPersistence(firebaseAuth, browserLocalPersistence);

export function explainFirebaseError(err: unknown) {
  const code = typeof err === "object" && err && "code" in err ? String(err.code) : "";
  if (code === "auth/email-already-in-use")
    return "That email already has an account. Sign in instead.";
  if (code === "auth/invalid-email") return "Enter a valid email address.";
  if (
    code === "auth/invalid-credential" ||
    code === "auth/wrong-password" ||
    code === "auth/user-not-found"
  ) {
    return "Email or password is incorrect.";
  }
  if (code === "auth/weak-password") return "Password is too weak. Use at least 6 characters.";
  if (code === "auth/operation-not-allowed") {
    return "Email sign-in is off in Firebase. Enable Email/Password in Authentication.";
  }
  if (code === "auth/too-many-requests") return "Too many attempts. Wait a minute and try again.";
  if (code === "auth/network-request-failed") return "No internet connection. Try again.";
  if (err instanceof Error && err.message) return err.message;
  return "Could not sign in.";
}
