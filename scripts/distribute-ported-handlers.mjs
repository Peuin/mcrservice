#!/usr/bin/env node
/**
 * Moves handler files from src/ported/ into src/modules/* and fixes import paths.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(__dirname, "../src");
const portedDir = path.join(srcDir, "ported");

/** Edge function name -> module-relative handler path under src/modules/ */
const HANDLER_TARGETS = {
  "app-feedback": "feedback/handler.ts",
  "app-search": "search/handler.ts",
  "app-search-warm": "search/warm-handler.ts",
  "ask-peuin": "aiask/ask-handler.ts",
  personality: "aiask/personality-handler.ts",
  "food-catalog": "gov-data/food-catalog/handler.ts",
  friends: "gov-data/friends/handler.ts",
  "goong-place-search": "map/goong-handler.ts",
  "home-feed": "feed/handler.ts",
  "home-feed-warm": "feed/warm-handler.ts",
  journal: "journal/handler.ts",
  "notification-push": "worker/notification-push-handler.ts",
  notifications: "notifications/legacy-handler.ts",
  profile: "profile/handler.ts",
  stories: "stories/handler.ts"
};

function importPrefix(moduleRelPath) {
  const depth = moduleRelPath.split("/").length;
  return "../".repeat(depth);
}

function fixImports(content, moduleRelPath) {
  const prefix = importPrefix(moduleRelPath);
  return content
    .replaceAll('from "../config/env.js"', `from "${prefix}config/env.js"`)
    .replaceAll('from "./runtime.js"', `from "${prefix}shared/handler-runtime.js"`)
    .replaceAll('from "./personality.js"', 'from "./personality-handler.js"');
}

function main() {
  for (const [name, target] of Object.entries(HANDLER_TARGETS)) {
    const source = path.join(portedDir, `${name}.ts`);
    const dest = path.join(srcDir, "modules", target);
    if (!fs.existsSync(source)) {
      console.warn(`skip missing ${source}`);
      continue;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const content = fixImports(fs.readFileSync(source, "utf8"), target);
    fs.writeFileSync(dest, content);
    console.log(`${name} -> modules/${target}`);
  }

  for (const leftover of fs.readdirSync(portedDir)) {
    const full = path.join(portedDir, leftover);
    if (fs.statSync(full).isFile()) {
      fs.unlinkSync(full);
      console.log(`removed ported/${leftover}`);
    }
  }
  if (fs.existsSync(portedDir)) {
    fs.rmdirSync(portedDir);
    console.log("removed src/ported/");
  }
}

main();
