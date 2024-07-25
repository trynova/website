import { css } from "utils/css.ts";

import { Logo } from "components/icons/Logo.tsx";
import { BASE_PATH } from "utils/consts.ts";

const classes = await css(import.meta.resolve("./Header.css"));

export function Header() {
  return (
    <header class={classes.header}>
      <a class={classes.logo} href={`${BASE_PATH}/`}>
        <Logo />
        <h1>Nova</h1>
      </a>
      <nav class={classes.navigation}>
        <a href={`${BASE_PATH}/talks`}>Talks</a>
        <a href={`${BASE_PATH}/blog`}>Blog</a>
        <a href={`${BASE_PATH}/test262`}>Test262</a>
        <a href="https://github.com/trynova/nova">Contribute</a>
      </nav>
    </header>
  );
}
