import { createApp } from "./app";
import { settings } from "./config";
createApp()
  .then(async (app) => {
    await app.listen(settings().port, "127.0.0.1");
    console.log(`Fleet API: http://127.0.0.1:${settings().port}/api/v1/health`);
  })
  .catch(() => {
    console.error(
      "Не удалось запустить API. Проверьте окружение и PostgreSQL.",
    );
    process.exitCode = 1;
  });
