import { expect, test } from "@playwright/test";

test("用户可以在浏览器中完成一轮中文普通对话", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "天气助手" })).toBeVisible();
  await page.getByRole("textbox", { name: "消息" }).fill("你好");
  await page.getByRole("button", { name: "发送" }).click();

  await expect(page.getByRole("status")).toHaveText("正在生成回答");
  await expect(page.getByText("你好！我是", { exact: false })).toBeVisible();
  await expect(page.getByText("你好！我是天气助手。请告诉我你想了解的地点。"))
    .toBeVisible();
  await expect(page.getByText("已完成")).toBeVisible();
});

test("当前页面会话会记住消息，但刷新后会话状态清空", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("textbox", { name: "消息" }).fill("你好");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("你好！我是天气助手。请告诉我你想了解的地点。"))
    .toBeVisible();

  await page.getByRole("textbox", { name: "消息" }).fill("我刚才说了什么？");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("你刚才说的是：你好。"))
    .toBeVisible();

  await page.reload();
  await page.getByRole("textbox", { name: "消息" }).fill("我刚才说了什么？");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("当前会话里还没有上一条消息。"))
    .toBeVisible();
});

test("地点有歧义时展示候选并在选择后确认", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("textbox", { name: "消息" }).fill("Springfield 天气");
  await page.getByRole("button", { name: "发送" }).click();

  await expect(
    page.getByRole("region", { name: "地点候选" }).getByText("请选择一个地点"),
  ).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("请选择一个地点");
  await expect(
    page.getByRole("button", { name: "Springfield, Illinois, 美国" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Springfield, Massachusetts, 美国" }),
  ).toBeVisible();

  await page
    .getByRole("button", { name: "Springfield, Illinois, 美国" })
    .click();

  await expect(
    page.getByText("已确认地点：Springfield, Illinois, 美国"),
  ).toBeVisible();
});

test("明确地点也会先经过地点候选确认", async ({ page }) => {
  await page.goto("/");

  await page
    .getByRole("textbox", { name: "消息" })
    .fill("北京今天会下雨吗");
  await page.getByRole("button", { name: "发送" }).click();

  const candidate = page.getByRole("button", { name: "北京市, 北京市, 中国" });
  await expect(candidate).toBeVisible();
  await candidate.click();

  await expect(page.getByText("已确认地点：北京市, 北京市, 中国")).toBeVisible();
});
