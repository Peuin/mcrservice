#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(new URL("../../..", import.meta.url).pathname);
const ignoreDirs = new Set([".git", "node_modules", "dist", "build", ".dart_tool", "_exports"]);
const scanRoots = ["BE/mcrservice/src", "BE/mcrservice/scripts", "PeuinJournal/lib", "PeuinJournal/scripts", "PeuinJournal/env.example", "PeuinJournal/.env"];
const failures = [];
const forbiddenFlutterEnvKeys = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_JWT_SECRET",
  "RESEND_API_KEY",
  "GEMINI_API_KEY",
  "UPSTASH_REDIS_REST_TOKEN",
  "OTP_HASH_SECRET",
  "BUNNY_STORAGE_API_KEY",
  "BUNNY_API_KEY",
  "GOONG_PLACE_API_KEY",
];

function listFiles(target) {
  const full = path.join(repoRoot, target);
  const stat = statSync(full);
  if (stat.isFile()) return [full];
  const files = [];
  for (const entry of readdirSync(full)) {
    if (ignoreDirs.has(entry)) continue;
    const child = path.join(full, entry);
    const childStat = statSync(child);
    if (childStat.isDirectory()) files.push(...listFiles(path.relative(repoRoot, child)));
    else files.push(child);
  }
  return files;
}

const files = scanRoots.flatMap(listFiles).filter((file) =>
  /\.(ts|tsx|js|mjs|dart|sh|env|example|md|yaml|yml|json)$/.test(file)
);

function rel(file) {
  return path.relative(repoRoot, file);
}

for (const file of files) {
  const text = readFileSync(file, "utf8");
  if (/mcrservice\.peuinjournal\.com\/(?:rest|auth|storage)\/v1/.test(text)) {
    failures.push(`${rel(file)} builds Supabase API URL from mcrservice domain`);
  }
  if (/API_BASE_URL[^;\n]*\/(?:rest|auth|storage)\/v1|AUTH_SERVICE_URL[^;\n]*\/(?:rest|auth|storage)\/v1/.test(text)) {
    failures.push(`${rel(file)} combines backend base URL with Supabase API path`);
  }
  if (rel(file).startsWith("PeuinJournal/")) {
    for (const key of forbiddenFlutterEnvKeys) {
      if (new RegExp(`^${key}=`, "m").test(text)) {
        failures.push(`${rel(file)} contains backend-only env key ${key}`);
      }
    }
  }
}

const rpcFiles = files.filter((file) => readFileSync(file, "utf8").includes('rpc("search_places"') || readFileSync(file, "utf8").includes("rpc('search_places'"));
for (const file of rpcFiles) {
  const text = readFileSync(file, "utf8");
  const rpcBlocks = text.match(/rpc\(["']search_places["'][\s\S]{0,180}?\}\s*\)/g) ?? [];
  for (const block of rpcBlocks) {
    if (!/p_query\s*:/.test(block) || !/p_limit\s*:/.test(block)) {
      failures.push(`${rel(file)} calls search_places without p_query and p_limit`);
    }
    if (/(^|[,{]\s*)query\s*:/.test(block)) {
      failures.push(`${rel(file)} calls search_places with query instead of p_query`);
    }
  }
}

if (failures.length > 0) {
  console.error("Supabase config check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Supabase config check passed.");
console.log("Quoted curl examples:");
console.log('curl -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $SUPABASE_ANON_KEY" "https://api.peuinjournal.com/rest/v1/places?limit=1"');
console.log('curl -X POST -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $SUPABASE_ANON_KEY" -H "Content-Type: application/json" -d \'{"p_query": "tra sua", "p_limit": 10}\' "https://api.peuinjournal.com/rest/v1/rpc/search_places"');
