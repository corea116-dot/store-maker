import { mkdir } from "node:fs/promises";
import { LOG_DIR } from "./lib/server/config.mjs";
import { createServer } from "./lib/server/http.mjs";

export { createServer };

if (import.meta.url === `file://${process.argv[1]}`) {
  await mkdir(LOG_DIR, { recursive: true });
  const portArg = process.argv.indexOf("--port");
  const port = portArg >= 0 ? Number(process.argv[portArg + 1]) : Number(process.env.PORT ?? 4317);
  const app = createServer();
  app.listen(port, "127.0.0.1", () => {
    console.log(`Store Maker running at http://127.0.0.1:${port}`);
  });
}
