// Regression checks for the requested emoji feedback and security-card polish.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = "native-android/app/src/main/java/app/kuchupuchu/android";
const emoji = readFileSync(resolve(`${base}/EmojiAnim.kt`), "utf8");
const chat = readFileSync(resolve(`${base}/ChatScreen.kt`), "utf8");
const loginStart = chat.indexOf("private fun LoginApprovalMessage(");
const loginEnd = chat.indexOf("/**\n * Owner round 13e", loginStart);
const loginCard = loginStart >= 0 && loginEnd > loginStart ? chat.slice(loginStart, loginEnd) : "";

const lines = [];
const check = (name, condition, detail = "") =>
  lines.push(`  ${condition ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);

check(
  "emoji glyph taps and long-presses have no visual indication while replay and manual haptics remain",
  emoji.includes("modifier = Modifier.combinedClickable(\n            indication = null,") &&
    emoji.includes("interactionSource = remember { MutableInteractionSource() }") &&
    emoji.includes("haptics.reaction()") &&
    emoji.includes("haptics.tap()") &&
    emoji.includes("replayKey++") &&
    emoji.includes('Api.post("/api/messages/$mid/fx"') &&
    !emoji.includes("hapticFeedbackEnabled = false"),
);
check(
  "login-approval OTP copy uses the Android clipboard and provides a compact Copy control beside the code",
  loginCard.includes('ClipData.newPlainText("Login approval code", otpCode)') &&
    loginCard.includes("androidx.compose.material3.TextButton(") &&
    loginCard.includes('Text("Copy", color = securityBlueText') &&
    loginCard.includes("Icons.Filled.ContentCopy") &&
    loginCard.includes("contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp)"),
);
check(
  "security card and OTP are compact and blue without an outline",
  loginCard.includes("val securityBlue = Color(0xFF2563EB)") &&
    loginCard.includes("val securitySurface =") &&
    loginCard.includes("val codeSurface =") &&
    loginCard.includes(".padding(vertical = 4.dp)") &&
    loginCard.includes(".padding(10.dp)") &&
    !loginCard.includes(".border("),
);
check(
  "approval and decline actions remain available and use the blue security palette",
  loginCard.includes("/api/auth/login/approve") &&
    loginCard.includes("/api/auth/login/decline") &&
    loginCard.includes('Text("Accept"') &&
    loginCard.includes('Text("Decline"') &&
    loginCard.includes("containerColor = securityBlue"),
);

for (const line of lines) console.log(line);
const broken = lines.filter((line) => line.startsWith("  BROKEN")).length;
process.exitCode = broken ? 1 : 0;
