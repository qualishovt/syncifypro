// Node resolve hook: the app uses Vite-style extensionless imports
// ("./db.server"), which plain Node resolves to a non-existent path. When the
// resolved file doesn't exist, retry with ".js".
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  const resolved = await nextResolve(specifier, context).catch(async (err) => {
    // Newer Node stats the file during resolve, so "./db.server" throws here
    // instead of resolving to a dead URL — retry any not-found relative
    // specifier with ".js", extension-looking or not.
    if (specifier.startsWith(".") && err?.code === "ERR_MODULE_NOT_FOUND") {
      return nextResolve(`${specifier}.js`, context);
    }
    throw err;
  });

  // NB: can't gate on "looks extensionless" — "./db.server" appears to end in
  // a ".server" extension. Just check whether the resolved file exists.
  if (resolved?.url?.startsWith("file:") && !existsSync(fileURLToPath(resolved.url))) {
    return nextResolve(`${specifier}.js`, context);
  }
  return resolved;
}
