import { existsSync, readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

// Network responses are synthetic; this test never sends a command to a real AVR.
test("AVR controls respect the measurement lock and retain explicit speaker mapping", async ({
  page,
}) => {
  const env = existsSync(".env.local")
    ? readFileSync(".env.local", "utf8")
    : "";
  const configuredURL = env.match(/^VITE_SUPABASE_URL=["']?([^\s"']+)/m)?.[1];
  test.skip(
    !configuredURL,
    "Requires the configured public Supabase URL (all requests intercepted)"
  );
  const host = new URL(configuredURL!).hostname;
  const owner = "10000000-0000-4000-8000-000000000001",
    workspace = "10000000-0000-4000-8000-000000000002",
    receiver = "10000000-0000-4000-8000-000000000003";
  let locked = false;
  const operations: Record<string, unknown>[] = [];
  await page.addInitScript(
    ({ key, owner }) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          access_token: "test-access-token",
          refresh_token: "test-refresh-token",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          token_type: "bearer",
          user: {
            id: owner,
            email: "avr@example.test",
            aud: "authenticated",
            role: "authenticated",
          },
        })
      );
    },
    { key: `sb-${host.split(".")[0]}-auth-token`, owner }
  );
  await page.route(`https://${host}/**`, async (route) => {
    const url = new URL(route.request().url()),
      now = new Date().toISOString();
    let data: unknown = [];
    if (url.pathname === "/auth/v1/user")
      data = {
        id: owner,
        email: "avr@example.test",
        aud: "authenticated",
        role: "authenticated",
      };
    else if (url.pathname.endsWith("/workspaces")) data = [{ id: workspace }];
    else if (url.pathname.endsWith("/avr_receivers"))
      data = [{ id: receiver, name: "Test AVC", mac_device_id: "test-mac" }];
    else if (url.pathname.endsWith("/avr_observations"))
      data = {
        receiver_id: receiver,
        observed_at: now,
        received_at: now,
        revision: "a".repeat(64),
        preset: null,
        measurement: locked ? { id: "measurement", interrupted: false } : null,
        state: {
          schemaVersion: 1,
          observedAt: now,
          zones: {
            zone1: {
              power: "ON",
              volume: 40,
              limit: 98,
              muted: false,
              source: "CD",
            },
          },
          channels: [
            { name: "FL", active: true, value: 24 },
            { name: "FHL", active: true, value: 24 },
          ],
          sources: [{ name: "CD", function: "CD", enabled: true }],
          modes: [{ name: "STEREO", selected: true }],
          surround: "STEREO",
          inputSignal: [],
          activeSpeakers: [],
          details: {},
          errors: {},
        },
      };
    else if (url.pathname.endsWith("/rpc/issue_avr_operation")) {
      operations.push(route.request().postDataJSON());
      data = {};
    } else if (url.pathname.endsWith("/avr_operations"))
      data = { completed_at: now, outcome: { status: "succeeded" } };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(data),
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /AVR/ }).click();
  await expect(page.getByText("Mac接続中", { exact: false })).toBeVisible();
  await page.getByLabel("このAVRの条件を測定前後に取得する").check();
  const mapping = page
    .getByRole("heading", { name: "測定条件との対応" })
    .locator("..");
  await mapping
    .getByRole("combobox", { name: "TFL", exact: true })
    .selectOption("FHL");
  await expect(
    mapping.getByRole("combobox", { name: "TFL", exact: true })
  ).toHaveValue("FHL");
  await page.getByRole("button", { name: "音量を適用", exact: true }).click();
  await expect.poll(() => operations.length).toBe(1);
  expect(operations[0].rev).toBe("a".repeat(64));
  expect(operations[0].action).toBe("volume");
  await expect(page.getByText("succeeded", { exact: true })).toBeVisible();
  locked = true;
  await expect(page.getByText(/測定ロック中/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "音量を適用", exact: true })
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "ミュートON", exact: true })
  ).toBeEnabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
});
