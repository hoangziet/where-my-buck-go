import { execFileSync } from "node:child_process";

const ALLOWED_UNPATCHED_ADVISORY = "https://github.com/advisories/GHSA-fc5q-39xc-vjpf";

function runAudit(args) {
  try {
    return execFileSync("npm", ["audit", ...args, "--json"], { encoding: "utf8" });
  } catch (error) {
    if (error.stdout) return error.stdout;
    throw error;
  }
}

function parseAudit(output) {
  try {
    return JSON.parse(output);
  } catch {
    throw new Error("npm audit did not return valid JSON");
  }
}

function advisoryRoots(name, vulnerabilities, visited = new Set()) {
  if (visited.has(name)) return new Set();
  visited.add(name);
  const vulnerability = vulnerabilities[name];
  if (!vulnerability) return new Set();

  const roots = new Set();
  for (const source of vulnerability.via) {
    if (typeof source === "string") {
      for (const root of advisoryRoots(source, vulnerabilities, visited)) roots.add(root);
    } else if (source.url) {
      roots.add(source.url);
    }
  }
  return roots;
}

const production = parseAudit(runAudit(["--omit=dev", "--audit-level=moderate"]));
if (production.metadata?.vulnerabilities?.total) {
  throw new Error("Production dependencies contain known vulnerabilities");
}

const full = parseAudit(runAudit([]));
const vulnerabilities = full.vulnerabilities ?? {};
const names = Object.keys(vulnerabilities);
if (names.length === 0) {
  console.log("Production and development dependency audits passed");
  process.exit(0);
}

const unexpected = names.flatMap((name) => {
  const roots = advisoryRoots(name, vulnerabilities);
  return roots.size === 1 && roots.has(ALLOWED_UNPATCHED_ADVISORY) ? [] : [name];
});
if (unexpected.length) {
  throw new Error(`Unexpected dependency advisories: ${unexpected.join(", ")}`);
}

console.warn(
  `Allowing only the currently unpatched development advisory ${ALLOWED_UNPATCHED_ADVISORY} ` +
    `(${names.length} affected dependency entries). Keep this exception until a patched release is available.`,
);
