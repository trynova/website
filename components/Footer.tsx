import { css } from "utils/css.ts";

import { CopyLeft } from "components/CopyLeft.tsx";

const classes = await css(import.meta.resolve("./Footer.css"));

export function Footer() {
  return (
    <footer class={classes.footer}>
      <a href="https://github.com/trynova">
        <CopyLeft /> {new Date().getFullYear()} The Nova Contributers
      </a>
    </footer>
  );
}
