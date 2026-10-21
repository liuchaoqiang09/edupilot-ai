import { register } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");

if (!process.env.EDUPILOT_TS_LOADER) {
  process.env.EDUPILOT_TS_LOADER = "1";
  register("./resolve-ts.mjs", { parentURL: import.meta.url });
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const file = pathToFileURL(path.join(root, specifier.slice(2))).href;
    const withExtension = /\.(?:[cm]?js|json|node|ts)$/.test(file) ? file : `${file}.ts`;
    return nextResolve(withExtension, context);
  }
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.(?:[cm]?js|json|node|ts)$/.test(specifier)) {
    return nextResolve(`${specifier}.ts`, context);
  }
  return nextResolve(specifier, context);
}
