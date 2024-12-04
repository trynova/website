import { css } from "utils/css.ts";

import { CopyLeft } from "components/CopyLeft.tsx";
import { GithubIcon } from "components/icons/Github.tsx";
import { DiscordIcon } from "components/icons/Discord.tsx";
import { BlueSkyIcon } from "components/icons/BlueSky.tsx";

const classes = await css(import.meta.resolve("./Footer.css"));

export function Footer() {
  return (
    <footer class={classes.footer}>
      <a href="https://github.com/trynova">
        <CopyLeft /> {new Date().getFullYear()} The Nova Contributors
      </a>
      <section class={classes.links}>
        <a aria-label="GitHub" href="https://github.com/trynova/nova">
          <GithubIcon />
        </a>
        <a aria-label="Discord" href="https://discord.gg/bwY4TRB8J7">
          <DiscordIcon />
        </a>
        <a aria-label="BlueSkye" href="https://bsky.app/profile/trynova.dev">
          <BlueSkyIcon />
        </a>
      </section>
    </footer>
  );
}
