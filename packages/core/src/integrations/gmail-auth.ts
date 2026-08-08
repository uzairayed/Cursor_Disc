/**
 * One-shot Gmail OAuth helper.
 *
 *   npx tsx packages/core/src/integrations/gmail-auth.ts
 *   # open printed URL, paste the code when prompted
 */
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { ROOT_DIR, loadEnvFile } from "../config/index.js";
import { join } from "node:path";
import {
  exchangeGmailCode,
  getGmailAuthUrl,
  loadGmailConfigFromEnv,
} from "./gmail.js";

async function main(): Promise<void> {
  loadEnvFile(join(ROOT_DIR, ".env"));
  loadEnvFile(join(ROOT_DIR, ".env.local"), { override: true });

  const config = loadGmailConfigFromEnv(process.env, ROOT_DIR);
  if (!config) {
    console.error(
      "Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in .env (see .env.example)."
    );
    process.exit(1);
  }

  const url = getGmailAuthUrl(config);
  console.log("Open this URL in a browser, approve read-only Gmail access:\n");
  console.log(url);
  console.log("\nThen paste the authorization code here.");

  const rl = createInterface({ input, output });
  const code = (await rl.question("Code: ")).trim();
  rl.close();
  if (!code) {
    console.error("No code provided.");
    process.exit(1);
  }

  await exchangeGmailCode(config, code);
  console.log(`Saved tokens to ${config.tokenPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
