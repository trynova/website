import { css } from "utils/css.ts";

import { CopyLeft } from "components/CopyLeft.tsx";
import { GithubIcon } from "components/icons/Github.tsx";
import { DiscordIcon } from "components/icons/Discord.tsx";
const classes = await css(import.meta.resolve("./Footer.css"));

export function Footer() {
  return (
    <footer class={classes.footer}>
      <a href="https://github.com/trynova">
        <CopyLeft /> {new Date().getFullYear()} The Nova Contributors
      </a>
      <div class={classes.links}>
        <a href="https://github.com/trynova/nova">
          <GithubIcon width="2em" height="2em" />
        </a>
        <a href="https://discord.gg/RTrgJzXKUM">
          <DiscordIcon width="2em" height="2em" />
        </a>
      </div>
    </footer>
  );
}
