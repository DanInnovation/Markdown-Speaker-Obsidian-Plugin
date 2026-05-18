# Markdown Speaker for Obsidian

这是 Markdown Speaker 的 Obsidian 三方插件版本。它会读取当前打开的 Markdown 笔记，用 Obsidian 自己的 Markdown 渲染器显示内容，并提供朗读、暂停、停止、Mark、语音选择、速度选择和可展开/收缩的大纲。

这个仓库的根目录就是 Obsidian 插件目录，可以直接复制或克隆到 `.obsidian/plugins/markdown-speaker/`。

## 安装

把这个仓库复制或克隆到你的 Obsidian vault：

```text
<你的 Vault>/.obsidian/plugins/markdown-speaker/
```

然后在 Obsidian 中打开：

```text
设置 -> 第三方插件 -> 关闭安全模式（如果还没关闭） -> 已安装插件 -> Markdown Speaker
```

启用后可以从命令面板运行：

```text
Markdown Speaker: Open reader for current note
```

## 功能

- 使用当前 Obsidian 文件作为阅读内容
- 使用 Obsidian 的 Markdown 渲染器显示正文，图片与附件按 vault 规则解析
- 支持浏览器系统语音和 macOS `say` 备用引擎
- 语言、发音、速度切换会在播放中即时生效
- 支持播放、暂停、停止、上一段、下一段
- 自动保存每个文件的上次朗读位置
- 支持手动保存 Mark 和回到 Mark
- 根据 Markdown 标题生成可展开/收缩的大纲
- 支持全局展开/收缩和局部展开/收缩

## 说明

这个插件是桌面版插件。浏览器系统语音来自 Obsidian/Electron 暴露的 `speechSynthesis`，macOS `say` 备用引擎只在 macOS 桌面环境可用。
