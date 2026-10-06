import { expect, test } from "@playwright/test";

test("upgrades an existing v1 cache without losing recordings or settings", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const request = indexedDB.open("immersive-acoustics-v1", 1);
    request.onupgradeneeded = () => {
      for (const name of [
        "results",
        "captures",
        "chunks",
        "experiments",
        "settings",
      ])
        request.result.createObjectStore(name);
      const transaction = request.transaction;
      if (!transaction) throw new Error("Missing database upgrade transaction");
      transaction.objectStore("settings").put("preserved", "legacy-marker");
      transaction
        .objectStore("chunks")
        .put(new Float32Array([0.125]).buffer, "legacy-pcm");
    };
    request.onsuccess = () => request.result.close();
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "部屋の音を、読み解く。" })
  ).toBeVisible();
  const stored = await page.evaluate(
    () =>
      new Promise<{
        version: number;
        observations: boolean;
        marker: unknown;
        pcm: number;
      }>((resolve, reject) => {
        const request = indexedDB.open("immersive-acoustics-v1");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(["settings", "chunks"]);
          const marker = tx.objectStore("settings").get("legacy-marker");
          const pcm = tx.objectStore("chunks").get("legacy-pcm");
          tx.oncomplete = () => {
            resolve({
              version: db.version,
              observations: db.objectStoreNames.contains("observations"),
              marker: marker.result,
              pcm: new Float32Array(pcm.result)[0],
            });
            db.close();
          };
          tx.onerror = () => reject(tx.error);
        };
      })
  );
  expect(stored).toEqual({
    version: 2,
    observations: true,
    marker: "preserved",
    pcm: 0.125,
  });
});
