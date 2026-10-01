// Web-login country formatting and metadata parity with Android's Countries.kt.
import { readFile } from "node:fs/promises";
import { buildE164, validOtp } from "../../public/login-utils.mjs";

const lines = [];
const check = (name, cond, detail) =>
  lines.push(`  ${cond ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);

const countryRows = JSON.parse(
  await readFile(new URL("../../public/countries.json", import.meta.url), "utf8"),
);
const kotlin = await readFile(
  new URL(
    "../../native-android/app/src/main/java/app/kuchupuchu/android/Countries.kt",
    import.meta.url,
  ),
  "utf8",
);
const kotlinList = kotlin.slice(kotlin.indexOf("val COUNTRIES"));
const androidRows = [...kotlinList.matchAll(/KpCountry\("([A-Z]{2})",\s*"([^"]+)",\s*"(\d+)"\)/g)]
  .map(([, iso, name, dial]) => ({ iso, name, dial }))
  .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
const webRows = [...countryRows].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
check(
  "Web country catalog matches Android ISO/name/dial metadata",
  JSON.stringify(webRows) === JSON.stringify(androidRows),
  `${webRows.length} Web / ${androidRows.length} Android`,
);
check(
  "country catalog has one row per ISO code and Bangladesh default metadata",
  countryRows.length === new Set(countryRows.map((c) => c.iso)).size &&
    countryRows.some((c) => c.iso === "BD" && c.name === "Bangladesh" && c.dial === "880") &&
    /DEFAULT_COUNTRY\s*=\s*KpCountry\("BD",\s*"Bangladesh",\s*"880"\)/.test(kotlin),
);

const bd = countryRows.find((c) => c.iso === "BD");
const us = countryRows.find((c) => c.iso === "US");
check(
  "Bangladesh local number drops trunk zero",
  buildE164("01712345678", bd) === "+8801712345678",
);
check(
  "Bangladesh pasted country code is not doubled",
  buildE164("8801712345678", bd) === "+8801712345678",
);
check(
  "pasted international number survives formatting whitespace",
  buildE164("+880 171 234 5678", bd) === "+8801712345678",
);
check(
  "repeated country prefix is collapsed once",
  buildE164("+8808801712345678", bd) === "+8801712345678",
);
check(
  "country prefix plus national trunk zero is normalized",
  buildE164("+880 01712345678", bd) === "+8801712345678",
);
check("invalid Bangladesh mobile prefix is rejected", buildE164("01112345678", bd) === null);
check(
  "selected US country builds E.164 from local number",
  buildE164("(202) 555-0123", us) === "+12025550123",
);
check(
  "international paste overrides the selected country",
  buildE164("+44 20 7946 0958", bd) === "+442079460958",
);
check(
  "00 international prefix is accepted",
  buildE164("0044 20 7946 0958", bd) === "+442079460958",
);
check(
  "numbers outside the worker's 8–15 digit range are rejected",
  buildE164("1234567890123456", us) === null,
);
check(
  "OTP formatting preserves leading zeroes",
  validOtp("012345") && !validOtp("12345") && !validOtp("12a456"),
);

const app = await readFile(new URL("../../public/app.js", import.meta.url), "utf8");
const html = await readFile(new URL("../../public/index.html", import.meta.url), "utf8");
const androidLogin = await readFile(
  new URL(
    "../../native-android/app/src/main/java/app/kuchupuchu/android/LoginScreen.kt",
    import.meta.url,
  ),
  "utf8",
);
const androidChat = await readFile(
  new URL(
    "../../native-android/app/src/main/java/app/kuchupuchu/android/ChatScreen.kt",
    import.meta.url,
  ),
  "utf8",
);
const androidSettings = await readFile(
  new URL(
    "../../native-android/app/src/main/java/app/kuchupuchu/android/SettingsScreen.kt",
    import.meta.url,
  ),
  "utf8",
);
check("browser keeps the honest no-SIM value", app.includes('sim: "UNAVAILABLE"'));
check(
  "Web login uses a country picker and dedicated OTP/recovery panels",
  html.includes("countryBtn") && html.includes("otpPanel") && html.includes("googlePanel"),
);
check(
  "country selection and six-digit entry are wired to the auth helpers",
  app.includes('$("countryBtn").addEventListener("click", openCountryPicker)') &&
    app.includes('$("otpSubmit").addEventListener("click", submitOtp)') &&
    app.includes("input.value.replace(/\\D/g"),
);
check(
  "Web approval card keeps the code in-app and exposes authenticated approve/decline actions",
  app.includes("function loginApprovalHtml(m)") &&
    app.includes('data-login-action="approve"') &&
    app.includes("/api/auth/login/${action}") &&
    app.includes("delete meta.otp"),
);
check(
  "Web auth always declares its platform and does not claim SIM evidence",
  app.includes('platform: "WEB"') && app.includes('sim: "UNAVAILABLE"'),
);
check(
  "Android accepts OTP while keeping approval polling active",
  androidLogin.includes("/api/auth/login/otp") &&
    androidLogin.includes('otpAvailable = data.optBoolean("otpAvailable")') &&
    androidLogin.includes("LaunchedEffect(stage, requestId)") &&
    androidLogin.includes("KeyboardType.Number"),
);
check(
  "Android approval card displays only a valid pending code and expires it locally",
  androidChat.includes('meta.optString("otp")') &&
    androidChat.includes('meta.optString("expiresAt")') &&
    androidChat.includes('meta.remove("otp")') &&
    androidChat.includes("val canApprove"),
);
check(
  "Android device settings label Web and Android sessions",
  androidSettings.includes('if (platform == "WEB") "Web" else "Android"') &&
    androidSettings.includes("platformLabel"),
);

console.log(lines.join("\n"));
const broken = lines.filter((line) => line.includes("BROKEN")).length;
console.log(`case 49: ${lines.length} checks, ${broken} broken`);
process.exit(broken ? 1 : 0);
