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
