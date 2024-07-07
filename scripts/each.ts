/**
 * A script to run each argument passed to the script after the `--` separator
 * as it's own process.
 *
 * @example
 * ```sh
 * deno task each run -A -- one.ts two.ts three.ts
 * # Runs three processes:
 * # deno run -A one.ts
 * # deno run -A two.ts
 * # deno run -A three.ts
 * ```
 *
 * @module
 */

if (import.meta.main) {
  const separator = Deno.args.findIndex((arg) => arg === "--");
  const args = separator === -1 ? [] : Deno.args.slice(0, separator);
  const entries = separator === -1 ? Deno.args : Deno.args.slice(separator + 1);

  (await Promise.all(
    entries.map((entry) =>
      new Deno.Command("deno", {
        args: [...args, entry],
        stdout: "inherit",
        stderr: "inherit",
      }).output()
    ),
  )).map((output) => {
    if (!output.success) {
      Deno.exit(output.code);
    }
  });
}
