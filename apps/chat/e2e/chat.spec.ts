import { expect, test, type Page } from "@playwright/test";

async function getBeijingDate(page: Page, daysAhead: number) {
  return page.evaluate((offset) => {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = formatter.formatToParts(new Date());
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const date = new Date(
      Date.UTC(
        Number(values.year),
        Number(values.month) - 1,
        Number(values.day) + offset,
        12,
      ),
    );
    const nextParts = formatter.formatToParts(date);
    const nextValues = Object.fromEntries(
      nextParts.map((part) => [part.type, part.value]),
    );
    return `${nextValues.year}-${nextValues.month}-${nextValues.day}`;
  }, daysAhead);
}

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

test("普通消息不会被误判成天气查询", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("textbox", { name: "消息" }).fill("聊天气氛很好");
  await page.getByRole("button", { name: "发送" }).click();

  await expect(page.getByText("我收到了你的消息：“聊天气氛很好”", {
    exact: false,
  })).toBeVisible();
  await expect(page.getByText("请先告诉我想查询的地点。")).toHaveCount(0);
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

test("确认地点后可以通过 Weather MCP 查询当前天气", async ({ page }) => {
  await page.goto("/");

  await page
    .getByRole("textbox", { name: "消息" })
    .fill("北京今天会下雨吗");
  await page.getByRole("button", { name: "发送" }).click();

  await page.getByRole("button", { name: "北京市, 北京市, 中国" }).click();

  await expect(
    page.getByText(
      "北京市, 北京市, 中国当前天气：18°C，晴。体感 17°C，降水概率 10%",
      {
      exact: false,
      },
    ),
  ).toBeVisible();
  await expect(page.getByText("数据时间：2026-01-15 08:00，时区：Asia/Shanghai", {
    exact: false,
  })).toBeVisible();
});

test("确认地点后可以省略地点继续询问当前天气", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("textbox", { name: "消息" }).fill("北京天气");
  await page.getByRole("button", { name: "发送" }).click();
  await page.getByRole("button", { name: "北京市, 北京市, 中国" }).click();
  await expect(page.getByText("北京市, 北京市, 中国当前天气：", { exact: false }))
    .toBeVisible();

  await page.getByRole("textbox", { name: "消息" }).fill("那现在天气怎么样");
  await page.getByRole("button", { name: "发送" }).click();

  await expect(
    page.getByText("北京市, 北京市, 中国当前天气：18°C，晴", { exact: false }),
  ).toHaveCount(2);
});

test("确认地点后可以查询未来三天预报并复用地点追问", async ({ page }) => {
  await page.goto("/");

  await page
    .getByRole("textbox", { name: "消息" })
    .fill("北京未来三天预报");
  await page.getByRole("button", { name: "发送" }).click();
  await page.getByRole("button", { name: "北京市, 北京市, 中国" }).click();

  const tomorrow = await getBeijingDate(page, 1);
  const thirdForecastDate = await getBeijingDate(page, 3);
  await expect(page.getByText("北京市, 北京市, 中国未来3天预报", { exact: false }))
    .toBeVisible();
  await expect(page.getByRole("status")).toHaveText("已完成", { timeout: 20_000 });
  await expect(page.getByText(tomorrow, { exact: false })).toBeVisible();
  await expect(page.getByText(thirdForecastDate, { exact: false })).toBeVisible();

  await page.getByRole("textbox", { name: "消息" }).fill("那明天呢");
  await page.getByRole("button", { name: "发送" }).click();

  await expect(page.getByText("北京市, 北京市, 中国未来1天预报", { exact: false }))
    .toBeVisible();
});

test("每日预报未指定范围时默认返回未来七天", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("textbox", { name: "消息" }).fill("北京天气预报");
  await page.getByRole("button", { name: "发送" }).click();
  await page.getByRole("button", { name: "北京市, 北京市, 中国" }).click();

  const seventhForecastDate = await getBeijingDate(page, 7);
  await expect(page.getByText("北京市, 北京市, 中国未来7天预报", { exact: false }))
    .toBeVisible();
  await expect(page.getByRole("status")).toHaveText("已完成", { timeout: 20_000 });
  await expect(page.getByText(seventhForecastDate, { exact: false })).toBeVisible();
});

test("刷新后不会继续使用已确认地点查询预报", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("textbox", { name: "消息" }).fill("北京天气");
  await page.getByRole("button", { name: "发送" }).click();
  await page.getByRole("button", { name: "北京市, 北京市, 中国" }).click();
  await expect(page.getByText("当前已确认地点：北京市, 北京市, 中国")).toBeVisible();

  await page.reload();
  await page.getByRole("textbox", { name: "消息" }).fill("那明天呢");
  await page.getByRole("button", { name: "发送" }).click();

  await expect(page.getByText("请先告诉我想查询的地点。")).toBeVisible();
});

test("可以比较两个地点同一天的每日天气", async ({ page }) => {
  await page.goto("/");
  const tomorrow = await getBeijingDate(page, 1);

  await page
    .getByRole("textbox", { name: "消息" })
    .fill(`比较北京和上海 ${tomorrow} 的天气`);
  await page.getByRole("button", { name: "发送" }).click();

  await expect(
    page.getByRole("button", { name: "北京市, 北京市, 中国" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "上海市, 上海市, 中国" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "北京市, 北京市, 中国" }).click();
  await page.getByRole("button", { name: "上海市, 上海市, 中国" }).click();

  await expect(page.getByText("同日天气比较", { exact: false })).toBeVisible();
  await expect(
    page.getByText("同日天气比较：北京市, 北京市, 中国", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("上海市, 上海市, 中国（", { exact: false }),
  ).toBeVisible();
  await expect(
    page.locator("li.message.assistant").filter({ hasText: "同日天气比较" }),
  ).toContainText(tomorrow);
  await expect(page.getByText("晴", { exact: false })).toBeVisible();
  await expect(page.getByText("多云", { exact: false })).toBeVisible();
});
