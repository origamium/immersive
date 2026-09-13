import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("records durable PCM and exports a consistent WAV using a synthetic microphone", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "Synthetic microphone flags are Chromium-specific"
  );
  await page.goto("/");
  await page.getByText("手動で原音だけを収録", { exact: true }).click();
  await page
    .getByRole("button", { name: "原音の収録を開始", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "■ 測定を停止" })
  ).toBeVisible();
  await expect
    .poll(() => page.getByRole("meter").getAttribute("value"), {
      timeout: 10000,
    })
    .not.toBe("-80");
  await page.getByRole("button", { name: "■ 測定を停止" }).click();
  await expect(page.getByText("原音を端末に保存しました")).toBeVisible();
  await page.getByRole("button", { name: /比較・履歴/ }).click();
  await expect(page.locator(".capture-row")).toContainText("complete");
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "WAV", exact: true }).click();
  const file = await (await pending).path();
  if (!file) throw new Error("Missing WAV export");
  const bytes = await readFile(file);
  expect(bytes.toString("ascii", 0, 4)).toBe("RIFF");
  expect(bytes.readUInt32LE(40)).toBe(bytes.length - 44);
  expect(bytes.length).toBeGreaterThan(44 + 32768 * 4);
});

test("imports an external response, exports, compares and preserves context after reload", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "部屋の音を、読み解く。" })
  ).toBeVisible();
  await page
    .locator('input[type=file][accept=".txt,.csv,.frd"]')
    .setInputFiles({
      name: "before.frd",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "20 70\n40 73\n80 76\n160 72\n320 70\n1000 70\n10000 69\n20000 68"
      ),
    });
  await expect(page.getByText("相対評価", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: /周波数応答/ })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "応答 CSV", exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.csv$/);
  await page
    .getByRole("button", { name: "測定", exact: false })
    .filter({ hasText: /^◎測定$/ })
    .count()
    .then(async (count) => {
      if (count)
        await page
          .getByRole("button")
          .filter({ hasText: /^◎測定$/ })
          .click();
      else await page.locator("nav button").first().click();
    });
  await page
    .locator('input[type=file][accept=".txt,.csv,.frd"]')
    .setInputFiles({
      name: "after.frd",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "20 70\n40 71\n80 72\n160 71\n320 70\n1000 70\n10000 69\n20000 68"
      ),
    });
  await page.getByRole("button", { name: /比較・履歴/ }).click();
  await page.getByLabel("変更前").selectOption({ label: "before.frd" });
  await page.getByLabel("変更後").selectOption({ label: "after.frd" });
  await expect(page.getByText(/差のRMS/)).toBeVisible();
  await page.getByLabel("仮説", { exact: true }).fill("壁面反射");
  await page.getByLabel("変更した内容").fill("スピーカーを20 cm移動");
  await page.getByRole("button", { name: "比較と変更内容を保存" }).click();
  await expect(page.getByText("FL / スピーカーを20 cm移動")).toBeVisible();
  await page.getByRole("button", { name: /部屋・機材/ }).click();
  await page.getByLabel("幅 [m]", { exact: true }).fill("4.5");
  await page.reload();
  await page.getByRole("button", { name: /部屋・機材/ }).click();
  await expect(page.getByLabel("幅 [m]", { exact: true })).toHaveValue("4.5");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  expect(errors).toEqual([]);
});
test("rejects malformed responses and never fabricates measurements", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .locator('input[type=file][accept=".txt,.csv,.frd"]')
    .setInputFiles({
      name: "bad.frd",
      mimeType: "text/plain",
      buffer: Buffer.from("20 0\n20 0\n40 0"),
    });
  await expect(page.getByRole("alert")).toContainText("重複");
  await page.getByRole("button", { name: /解析/ }).click();
  await expect(
    page.getByRole("heading", { name: "まだ測定結果がありません" })
  ).toBeVisible();
});

test("AVR tab explains Mac setup without inventing a connected receiver", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: /AVR/, exact: false }).click();
  await expect(page.getByRole("heading", { name: "AVR Control" })).toBeVisible();
  await expect(page.getByText(/Mac Companionの「AVR \/ HomeKit」/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
