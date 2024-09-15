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
    entries.map(async (entry) => {
      const command = `deno ${args.join(" ")} ${entry}`;
      const start = performance.now();
      let output;
      try {
        output = await new Deno.Command("deno", {
          args: [...args, entry],
          stdout: "inherit",
          stderr: "inherit",
        }).output();
      } catch (error) {
        console.error(`Failed to run "${command}"`);
        console.error(error);
        Deno.exit(1);
      }

      if (!output.success) {
        console.error(`Process "${command}" exited with ${output.code}`);
        Deno.exit(output.code);
      }

      console.info(`Successfully ran "${command}" in ${(performance.now() - start).toFixed(0)}ms`);
    })
  ));
}
