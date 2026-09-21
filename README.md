# Weather Assistant

一个本地运行的中文天气助手 POC，包含聊天应用和独立的 Weather MCP 服务。

## 安装

```powershell
npm install
```

## 本地启动

在第一个终端启动 Weather MCP：

```powershell
$env:WEATHER_MCP_DATA_SOURCE = "fixture"
npm run dev:mcp
```

在第二个终端启动聊天应用：

```powershell
$env:DEEPSEEK_API_KEY = ""
npm run dev
```

打开 <http://localhost:3000>。未配置 `DEEPSEEK_API_KEY` 时，聊天应用使用确定性回答替身；Weather MCP 使用确定性天气替身，适合本地验证和端到端测试。

## 使用和风天气

将 Weather MCP 的数据源切换为 `qweather`，并只在后端终端设置以下环境变量：

```powershell
$env:WEATHER_MCP_DATA_SOURCE = "qweather"
$env:QWEATHER_KEY_ID = "..."
$env:QWEATHER_DEVELOPER_ID = "..."
$env:QWEATHER_PROJECT_ID = "..."
$env:QWEATHER_PRIVATE_KEY = "..."
$env:QWEATHER_API_HOST = "https://..."
npm run dev:mcp
```

和风天气凭据、DeepSeek API Key 和专属 API Host 不应写入前端代码、浏览器可访问的环境变量、日志或版本库。

## 验证

```powershell
npm run typecheck
npm run test:e2e
```

端到端测试会自动启动两个本地服务，并使用确定性替身覆盖正常查询、每日预报、地点确认、连续追问、定位回退、MCP 失败和数据源失败场景。
