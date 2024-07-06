import { BUILD_PATH, PUBLIC_PATH } from "utils/consts.ts";
import { copy } from "utils/fs.ts";

if (import.meta.main) {
  await copy(PUBLIC_PATH, BUILD_PATH);
}
