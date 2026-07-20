# Rock Kingdom PVP AI Agent
# 洛克王国手游 PVP AI 代打系统

## 概述

基于 Mobile-Agent 开源项目改造的《洛克王国》手游 PVP 透明 AI 代打系统。

### 核心特性

- **透明思考**：AI 的每一步决策都在 HUD 弹幕中实时展示
- **多模态视觉**：使用 SenseNova 6.7 Flash-Lite 直接理解游戏画面
- **深度推理**：使用 DeepSeek V4 Flash 进行战局分析和策略决策
- **完整闭环**：从进入游戏 → 匹配 → 战斗 → 结算，全自动完成
- **可解释优先**：不只是点击，而是展示为什么这样点击

### 系统架构

```
截图 → 多模态解析 → BattleState → 策略推理 → HUD弹幕 → 点击执行 → 循环
```

### 文件结构

```
src/lib/pvp/           # 核心逻辑层
  types.ts              # 类型定义
  sensenova-provider.ts # SenseNova API 封装
  battle-state-parser.ts # 战局状态解析器
  strategy-engine.ts    # 策略引擎
  battle-loop.ts        # 战斗循环控制器
  index.ts              # 统一导出

src/components/pvp/     # UI 组件层
  PvPHud.tsx            # HUD 弹幕组件

src/app/pvp/            # 页面路由
  index.tsx             # PVP 主页面
```

### 配置步骤

1. 在 [SenseNova 控制台](https://console.sensenova.cn) 申请 API Key
2. 在 Mobile Agent 的 Settings → Providers 中添加 SenseNova
   - Base URL: `https://token.sensenova.cn/v1`
   - Model: `sensenova-6.7-flash-lite`（视觉解析）
   - Model: `deepseek-v4-flash`（策略推理）
3. 打开 PVP 页面，点击「开始代打」

### 模型分工

| 模型 | 用途 | 原因 |
|------|------|------|
| sensenova-6.7-flash-lite | 截图→BattleState | 多模态，支持图片输入，256K上下文 |
| deepseek-v4-flash | BattleState→决策 | 1M上下文，深度推理，reasoning流式输出 |

### 技术栈

- React Native / Expo (Mobile-Agent)
- TypeScript
- SenseNova API (OpenAI 兼容)
- ADB / Android 无障碍服务

### License

MIT (继承自 Mobile-Agent)
