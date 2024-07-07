import init, { transform } from "lightningcss";

import { fromFileUrl } from "@std/path";

await init();

/**
 * A map of CSS modules to their class names and transformed code.
 */
export const globalStyles: Record<string, {
  code: string;
  classes: Record<string, string>;
}> = {};

/**
 * Imports and transforms a CSS module file into an object of class names. Also
 * adds the CSS to the global stylesheet, injecting it into the head of the HTML.
 */
export async function css(path: string) {
  path = fromFileUrl(path);

  if (globalStyles[path]) return globalStyles[path].classes;

  const result = transform({
    filename: path,
    cssModules: true,
    code: await Deno.readFile(path),
    minify: true,
  });
  const code = new TextDecoder().decode(result.code);
  const classes = Object.fromEntries(
    Object.entries(result.exports ?? {}).map((
      [key, value],
    ) => [
      key,
      [value.name, value.composes.map((reference) => reference.name)].join(" "),
    ]),
  );

  globalStyles[path] = {
    code,
    classes,
  };

  return classes;
}
