import { css } from "utils/css.ts";

const classes = await css(import.meta.resolve("./CopyLeft.css"));

export function CopyLeft() {
  return <span class={classes.copyleft}>©</span>;
}
