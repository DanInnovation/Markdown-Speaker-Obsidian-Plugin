const {
  Component,
  ItemView,
  MarkdownRenderer,
  Notice,
  Plugin,
  TFile,
} = require("obsidian");

const VIEW_TYPE = "markdown-speaker-view";
const PLAY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="ms-fill" d="M8.7 6.4v11.2L17.3 12 8.7 6.4z"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6.5v11"/><path d="M15 6.5v11"/></svg>';

const DEFAULT_SETTINGS = {
  engine: "say",
  rate: 190,
  browserVoice: "",
  browserLocale: "",
  sayVoice: "",
  sayLocale: "",
  autoMarks: {},
  manualMarks: {},
};

function createEl(tag, className, parent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (parent) parent.appendChild(node);
  return node;
}

function createIconButton(parent, className, label, svg) {
  const button = createEl("button", `ms-icon-button ${className || ""}`.trim(), parent);
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.title = label;
  button.innerHTML = svg;
  return button;
}

function nextFrame() {
  return new Promise((resolve) => window.requestAnimationFrame(resolve));
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[ch]));
}

function stripFrontmatter(markdown) {
  return String(markdown || "").replace(/\r\n?/g, "\n").replace(/^---\n[\s\S]*?\n---\n/, "");
}

function speechText(markdown) {
  return stripFrontmatter(markdown)
    .replace(/```[\s\S]*?```/g, "\n")
    .replace(/!\[\[[^\]]+\]\]/g, "\n")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*[-*_]{3,}\s*$/gm, "")
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/[*_~]{1,3}/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/^\s*\|/gm, "")
    .replace(/\|\s*$/gm, "")
    .replace(/\s*\|\s*/g, "，")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function titleText(markdown) {
  return speechText(markdown)
    .replace(/\[![^\]\s]+[^\]]*\][+-]?\s*/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function splitMarkdownBlocks(markdown) {
  const lines = stripFrontmatter(markdown).split("\n");
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    while (i < lines.length && !lines[i].trim()) i += 1;
    if (i >= lines.length) break;

    const start = i;
    const line = lines[i];
    const fence = line.match(/^\s*(```|~~~)/);
    if (fence) {
      i += 1;
      while (i < lines.length && !lines[i].startsWith(fence[1])) i += 1;
      if (i < lines.length) i += 1;
      blocks.push(lines.slice(start, i).join("\n"));
      continue;
    }

    if (/^\s{0,3}#{1,6}\s+/.test(line) || /^\s*[-*_]{3,}\s*$/.test(line)) {
      blocks.push(line);
      i += 1;
      continue;
    }

    while (i < lines.length && lines[i].trim()) {
      if (i > start && /^\s{0,3}#{1,6}\s+/.test(lines[i])) break;
      i += 1;
    }
    blocks.push(lines.slice(start, i).join("\n"));
  }

  return blocks
    .map((source) => ({ source, text: speechText(source) }))
    .filter((block) => block.source.trim() || block.text);
}

function extractMarkdownTitle(markdown, fallback) {
  const text = stripFrontmatter(markdown || "");
  const h1 = text.match(/^\s{0,3}#\s+(.+?)\s*#*\s*$/m);
  if (h1) return titleText(h1[1]) || fallback;
  const firstLine = text.split("\n").map((line) => line.trim()).find(Boolean);
  return firstLine ? titleText(firstLine).slice(0, 80) || fallback : fallback;
}

function localeLabel(locale) {
  if (!locale) return "未知语言";
  const normalized = String(locale).replace("_", "-");
  const [language, region] = normalized.split("-");
  try {
    const languageName = new Intl.DisplayNames(["zh-CN"], { type: "language" }).of(language) || language;
    if (!region) return languageName;
    const regionName = new Intl.DisplayNames(["zh-CN"], { type: "region" }).of(region.toUpperCase()) || region;
    return `${languageName}（${regionName}）`;
  } catch (_error) {
    const fallback = {
      zh: "中文",
      en: "英语",
      ja: "日语",
      ko: "韩语",
      fr: "法语",
      de: "德语",
      es: "西班牙语",
      it: "意大利语",
      pt: "葡萄牙语",
      ru: "俄语",
    };
    return fallback[language] || normalized;
  }
}

async function renderMarkdown(app, markdown, target, sourcePath, component) {
  if (MarkdownRenderer.render) {
    await MarkdownRenderer.render(app, markdown, target, sourcePath, component);
    return;
  }
  await MarkdownRenderer.renderMarkdown(markdown, target, sourcePath, component);
}

class MarkdownSpeakerPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

    this.registerView(VIEW_TYPE, (leaf) => new MarkdownSpeakerView(leaf, this));

    this.addRibbonIcon("audio-lines", "Markdown Speaker", () => {
      this.activateView();
    });

    this.addCommand({
      id: "open-markdown-speaker",
      name: "Open reader for current note",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const ok = file instanceof TFile && file.extension === "md";
        if (ok && !checking) this.activateView(file);
        return ok;
      },
    });

    this.addCommand({
      id: "markdown-speaker-play-pause",
      name: "Play or pause current speaker view",
      callback: () => this.forEachView((view) => view.playOrPause()),
    });

    this.registerEvent(this.app.workspace.on("file-open", (file) => {
      if (!(file instanceof TFile) || file.extension !== "md") return;
      this.forEachView((view) => view.loadFile(file));
    }));
  }

  onunload() {
    this.forEachView((view) => view.stopSpeech(true));
  }

  stopOtherViews(activeView) {
    this.forEachView((view) => {
      if (view !== activeView) view.stopSpeech(false);
    });
  }

  async activateView(file) {
    const targetFile = file || this.app.workspace.getActiveFile();
    if (!(targetFile instanceof TFile) || targetFile.extension !== "md") {
      new Notice("请先打开一个 Markdown 笔记");
      return;
    }

    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf(true);
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
    if (leaf.view instanceof MarkdownSpeakerView) {
      await leaf.view.loadFile(targetFile);
    }
  }

  forEachView(callback) {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof MarkdownSpeakerView) callback(leaf.view);
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class MarkdownSpeakerView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.file = null;
    this.markdown = "";
    this.chunks = [];
    this.current = 0;
    this.playing = false;
    this.paused = false;
    this.browserVoices = [];
    this.sayVoices = [];
    this.browserUtterance = null;
    this.sayProcess = null;
    this.sayStartedAt = 0;
    this.speechGeneration = 0;
    this.speechStarting = false;
    this.settingsApplyToken = 0;
    this.applyTimer = null;
    this.renderGeneration = 0;
    this.outline = [];
    this.outlineTree = [];
    this.outlineCollapsed = new Set();
    this.outlineOpen = false;
    this.renderComponent = null;
    this.controlsResizeObserver = null;
    this.controlsHeightFrame = null;
    this.lastControlsHeight = 0;
  }

  getViewType() {
    return VIEW_TYPE;
  }

  getDisplayText() {
    return "Markdown Speaker";
  }

  getIcon() {
    return "audio-lines";
  }

  async onOpen() {
    this.buildLayout();
    this.loadVoices();
    const file = this.app.workspace.getActiveFile();
    if (file instanceof TFile && file.extension === "md") {
      await this.loadFile(file);
    } else {
      this.renderEmpty();
    }
  }

  async onClose() {
    window.clearTimeout(this.applyTimer);
    this.applyTimer = null;
    if (this.controlsResizeObserver) {
      this.controlsResizeObserver.disconnect();
      this.controlsResizeObserver = null;
    }
    if (this.controlsHeightFrame !== null) {
      window.cancelAnimationFrame(this.controlsHeightFrame);
      this.controlsHeightFrame = null;
    }
    await this.stopSpeech(true);
    if (this.renderComponent) this.renderComponent.unload();
  }

  buildLayout() {
    this.containerEl.empty();
    this.root = createEl("div", "markdown-speaker-view", this.containerEl);

    const topbar = createEl("div", "ms-topbar", this.root);
    this.titleButton = createEl("button", "ms-title-button", topbar);
    this.titleButton.type = "button";
    this.titleButton.title = "展开大纲";
    this.titleButton.setAttribute("aria-expanded", "false");
    this.titleText = createEl("span", "ms-title-text", this.titleButton);
    this.titleText.textContent = "Markdown Speaker";
    this.titleButton.insertAdjacentHTML(
      "beforeend",
      '<svg class="ms-title-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    );

    const fileActions = createEl("div", "ms-file-actions", topbar);
    this.saveMarkButton = createIconButton(fileActions, "", "保存书签", '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5.8c0-1 .8-1.8 1.8-1.8h6.4c1 0 1.8.8 1.8 1.8v13.7l-5-3.1-5 3.1V5.8z"/></svg>');
    this.restoreMarkButton = createIconButton(fileActions, "", "回到书签", '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5.8c0-1 .8-1.8 1.8-1.8h6.4c1 0 1.8.8 1.8 1.8v13.7l-5-3.1-5 3.1V5.8z"/><path d="M10 10.2h4"/><path d="M12 8.2v4"/></svg>');

    this.outlinePanel = createEl("aside", "ms-outline-panel is-hidden", this.root);
    const outlineActions = createEl("div", "ms-outline-actions", this.outlinePanel);
    this.expandAllButton = createIconButton(outlineActions, "ms-outline-action", "全部展开", '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 2.8h8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>');
    this.collapseAllButton = createIconButton(outlineActions, "ms-outline-action", "全部收起", '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 10l4-4 4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 13.2h8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>');
    this.outlineItems = createEl("div", "ms-outline-items", this.outlinePanel);

    this.readerShell = createEl("div", "ms-reader-shell", this.root);
    this.reader = createEl("div", "ms-reader", this.readerShell);

    this.controls = createEl("section", "ms-controls", this.root);
    const playbackRow = createEl("div", "ms-playback-row", this.controls);
    this.playButton = createIconButton(playbackRow, "ms-primary ms-play-button", "播放", PLAY_ICON);
    this.stopButton = createIconButton(playbackRow, "", "停止", '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="8" height="8" rx="1.5"/></svg>');
    this.prevButton = createIconButton(playbackRow, "", "上一段", '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 6.5v11"/><path d="M17 7.5L9.5 12l7.5 4.5V7.5z"/></svg>');
    this.nextButton = createIconButton(playbackRow, "", "下一段", '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 6.5v11"/><path d="M7 7.5l7.5 4.5L7 16.5V7.5z"/></svg>');

    const voiceRow = createEl("div", "ms-voice-row", this.controls);
    this.engineSelect = createEl("select", "ms-engine", voiceRow);
    this.engineSelect.title = "朗读引擎";
    this.engineSelect.innerHTML = '<option value="say">macOS 发音库</option><option value="browser">浏览器备用语音</option>';
    this.voiceSelect = createEl("select", "ms-voice", voiceRow);
    this.voiceSelect.title = "发音";
    this.languageSelect = createEl("select", "ms-language", voiceRow);
    this.languageSelect.title = "语言";
    const rate = createEl("div", "ms-rate", voiceRow);
    createEl("span", "", rate).textContent = "速度";
    this.rateInput = createEl("input", "", rate);
    this.rateInput.type = "range";
    this.rateInput.min = "90";
    this.rateInput.max = "360";
    this.rateInput.value = String(this.plugin.settings.rate || 190);
    this.rateValue = createEl("span", "", rate);
    this.rateValue.textContent = this.rateInput.value;
    this.updateRateFill();

    this.meta = createEl("div", "ms-meta", this.root);
    this.statusEl = createEl("span", "", this.meta);
    this.progressEl = createEl("span", "", this.meta);
    this.setStatus("准备就绪");

    this.bindEvents();
    this.observeControlsHeight();
  }

  observeControlsHeight() {
    if (this.controlsResizeObserver) this.controlsResizeObserver.disconnect();
    if (this.controlsHeightFrame !== null) {
      window.cancelAnimationFrame(this.controlsHeightFrame);
      this.controlsHeightFrame = null;
    }
    const measure = () => {
      this.controlsHeightFrame = null;
      if (!this.root || !this.controls) return;
      const height = Math.ceil(this.controls.getBoundingClientRect().height || 116);
      if (height === this.lastControlsHeight) return;
      this.lastControlsHeight = height;
      this.root.style.setProperty("--ms-controls-height", `${height}px`);
    };
    const schedule = () => {
      if (this.controlsHeightFrame !== null) return;
      this.controlsHeightFrame = window.requestAnimationFrame(measure);
    };
    schedule();
    if (window.ResizeObserver) {
      this.controlsResizeObserver = new ResizeObserver(schedule);
      this.controlsResizeObserver.observe(this.controls);
    }
  }

  bindEvents() {
    this.titleButton.addEventListener("click", (event) => {
      event.stopPropagation();
      this.toggleOutline();
    });

    this.root.addEventListener("click", (event) => {
      if (!this.outlineOpen) return;
      if (event.target.closest(".ms-title-button") || event.target.closest(".ms-outline-panel")) return;
      this.setOutlineOpen(false);
    });

    this.saveMarkButton.addEventListener("click", () => this.saveManualMark());
    this.restoreMarkButton.addEventListener("click", () => this.restoreManualMark());
    this.expandAllButton.addEventListener("click", (event) => {
      event.stopPropagation();
      this.setAllOutlineNodesExpanded(true);
    });
    this.collapseAllButton.addEventListener("click", (event) => {
      event.stopPropagation();
      this.setAllOutlineNodesExpanded(false);
    });
    this.outlineItems.addEventListener("click", (event) => {
      const disclosure = event.target.closest(".ms-outline-disclosure");
      if (disclosure && !disclosure.classList.contains("is-placeholder")) {
        event.stopPropagation();
        this.toggleOutlineNode(disclosure.dataset.id);
        return;
      }
      const item = event.target.closest(".ms-outline-link");
      if (item) {
        event.preventDefault();
        event.stopPropagation();
        this.goToChunk(Number(item.dataset.index));
        this.setOutlineOpen(false);
      }
    });
    this.outlinePanel.addEventListener("click", (event) => {
      if (event.target === this.outlinePanel || event.target === this.outlineItems) this.setOutlineOpen(false);
    });

    this.reader.addEventListener("click", (event) => {
      const chunk = event.target.closest(".ms-chunk");
      if (chunk) this.goToChunk(Number(chunk.dataset.index));
    });

    this.playButton.addEventListener("click", () => this.playOrPause());
    this.stopButton.addEventListener("click", () => this.stopSpeech(true));
    this.prevButton.addEventListener("click", () => this.moveChunk(-1));
    this.nextButton.addEventListener("click", () => this.moveChunk(1));

    this.engineSelect.addEventListener("change", async () => {
      this.plugin.settings.engine = this.engineSelect.value;
      await this.plugin.saveSettings();
      const shouldResume = this.playing && !this.paused;
      this.settingsApplyToken += 1;
      await this.stopSpeech(false);
      this.playing = shouldResume;
      this.paused = false;
      this.populateLanguages();
      await this.renderContent();
      if (shouldResume) this.speakCurrent();
    });
    this.languageSelect.addEventListener("change", async () => {
      this.updateVoiceOptions();
      await this.applySettingsNow();
    });
    this.voiceSelect.addEventListener("change", async () => {
      this.saveVoiceSettings();
      await this.applySettingsNow();
    });
    this.rateInput.addEventListener("input", () => {
      this.rateValue.textContent = this.rateInput.value;
      this.updateRateFill();
      this.plugin.settings.rate = Number(this.rateInput.value);
      this.plugin.saveSettings();
      this.applySettingsSoon();
    });
  }

  updateRateFill() {
    if (!this.rateInput) return;
    const min = Number(this.rateInput.min || 0);
    const max = Number(this.rateInput.max || 100);
    const value = Number(this.rateInput.value || min);
    const percent = max > min ? ((value - min) / (max - min)) * 100 : 0;
    this.rateInput.style.setProperty("--ms-rate-fill", `${Math.max(0, Math.min(100, percent))}%`);
  }

  loadVoices() {
    this.loadBrowserVoices();
    this.loadSayVoices();
    this.engineSelect.value = this.plugin.settings.engine || "say";
    if (this.engineSelect.value === "browser" && !this.browserVoices.length) this.engineSelect.value = "say";
    if (this.engineSelect.value === "say" && !this.sayVoices.length && this.browserVoices.length) this.engineSelect.value = "browser";
    if (window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = () => {
        this.loadBrowserVoices();
        if (this.engineSelect.value === "browser") this.populateLanguages();
      };
    }
    this.populateLanguages();
  }

  loadBrowserVoices() {
    if (!window.speechSynthesis) {
      this.browserVoices = [];
      return;
    }
    this.browserVoices = window.speechSynthesis.getVoices().map((voice) => ({
      name: voice.name,
      locale: voice.lang || "",
      raw: voice,
    }));
  }

  loadSayVoices() {
    try {
      const childProcess = require("child_process");
      const output = childProcess.execFileSync("say", ["-v", "?"], { encoding: "utf8" });
      const pattern = /^(.+?)\s+([a-z]{2}_[A-Z0-9]{2,3})\s+#\s*(.*)$/;
      this.sayVoices = output.split(/\r?\n/).map((line) => {
        const match = line.match(pattern);
        if (!match) return null;
        return { name: match[1].trim(), locale: match[2].trim(), sample: match[3].trim() };
      }).filter(Boolean);
    } catch (_error) {
      this.sayVoices = [];
    }
  }

  activeVoices() {
    return this.engineSelect.value === "browser" ? this.browserVoices : this.sayVoices;
  }

  populateLanguages() {
    const locales = [...new Set(this.activeVoices().map((v) => v.locale).filter(Boolean))].sort();
    this.languageSelect.replaceChildren();
    const all = document.createElement("option");
    all.value = "";
    all.textContent = "全部语言";
    this.languageSelect.appendChild(all);
    for (const locale of locales) {
      const option = document.createElement("option");
      option.value = locale;
      option.textContent = localeLabel(locale);
      this.languageSelect.appendChild(option);
    }
    const saved = this.engineSelect.value === "browser" ? this.plugin.settings.browserLocale : this.plugin.settings.sayLocale;
    this.languageSelect.value = locales.includes(saved) ? saved : "";
    this.updateVoiceOptions();
  }

  updateVoiceOptions() {
    const locale = this.languageSelect.value;
    const filtered = this.activeVoices().filter((voice) => !locale || voice.locale === locale);
    this.voiceSelect.replaceChildren();
    for (const voice of filtered) {
      const option = document.createElement("option");
      option.value = voice.name;
      option.textContent = `${voice.name}${voice.locale ? ` [${voice.locale}]` : ""}`;
      this.voiceSelect.appendChild(option);
    }
    this.voiceSelect.value = this.preferredVoice(filtered);
    this.saveVoiceSettings();
  }

  preferredVoice(filtered) {
    const saved = this.engineSelect.value === "browser" ? this.plugin.settings.browserVoice : this.plugin.settings.sayVoice;
    if (saved && filtered.some((voice) => voice.name === saved)) return saved;
    const siri = filtered.find((voice) => /siri/i.test(voice.name));
    if (siri) return siri.name;
    const zh = filtered.find((voice) => String(voice.locale || "").toLowerCase().startsWith("zh"));
    if (zh) return zh.name;
    return filtered[0] ? filtered[0].name : "";
  }

  saveVoiceSettings() {
    if (this.engineSelect.value === "browser") {
      this.plugin.settings.browserLocale = this.languageSelect.value;
      this.plugin.settings.browserVoice = this.voiceSelect.value;
    } else {
      this.plugin.settings.sayLocale = this.languageSelect.value;
      this.plugin.settings.sayVoice = this.voiceSelect.value;
    }
    this.plugin.saveSettings();
  }

  async loadFile(file) {
    if (!(file instanceof TFile) || file.extension !== "md") return;
    if (this.playing || this.paused || (this.file && this.file.path !== file.path)) {
      await this.stopSpeech(false);
    }
    this.file = file;
    this.markdown = await this.app.vault.cachedRead(file);
    this.chunks = splitMarkdownBlocks(this.markdown);
    this.outlineCollapsed = new Set();
    this.current = Math.max(
      0,
      Math.min(
        Number(this.plugin.settings.autoMarks[file.path] || this.plugin.settings.manualMarks[file.path] || 0),
        Math.max(0, this.chunks.length - 1)
      )
    );
    this.titleText.textContent = extractMarkdownTitle(this.markdown, file.basename);
    this.playing = false;
    this.paused = false;
    this.buildOutline();
    await this.renderContent();
    this.setStatus(`已载入 ${this.chunks.length} 段`);
  }

  renderEmpty() {
    this.reader.classList.add("is-empty");
    this.reader.replaceChildren();
    const empty = createEl("div", "ms-empty", this.reader);
    const logo = createEl("img", "ms-empty-logo", empty);
    logo.alt = "";
    logo.src = this.getAssetUrl("assets/dan-logo-y.png");
    const copy = createEl("div", "", empty);
    copy.innerHTML = "打开一个 Markdown 笔记，<br>再运行 Markdown Speaker。<br>会自动使用 Obsidian 的附件与图片解析。";
    this.setStatus("准备就绪");
    this.updateControls();
  }

  getAssetUrl(path) {
    const dir = this.plugin.manifest.dir || ".obsidian/plugins/markdown-speaker";
    return this.app.vault.adapter.getResourcePath(`${dir}/${path}`);
  }

  async renderContent() {
    const generation = ++this.renderGeneration;
    if (!this.chunks.length) {
      this.reader.classList.add("is-empty");
      this.reader.replaceChildren();
      createEl("div", "ms-empty", this.reader).textContent = this.file ? "这个文件没有可朗读的文本。" : "请先打开一个 Markdown 笔记。";
      this.setStatus(this.file ? "没有内容" : "准备就绪");
      this.updateControls();
      return;
    }

    this.reader.classList.remove("is-empty");
    this.reader.replaceChildren();
    if (this.renderComponent) this.renderComponent.unload();
    this.renderComponent = new Component();
    this.addChild(this.renderComponent);

    for (let index = 0; index < this.chunks.length; index += 1) {
      if (generation !== this.renderGeneration) return;
      const chunk = this.chunks[index];
      const row = createEl("div", `ms-chunk${index === this.current ? " is-current" : ""}`, this.reader);
      row.dataset.index = String(index);
      const marker = createEl("span", "ms-index", row);
      marker.textContent = `${String(index + 1).padStart(3, "0")}.`;
      const body = createEl("div", "ms-markdown", row);
      await renderMarkdown(this.app, chunk.source, body, this.file.path, this.renderComponent);
    }

    this.renderOutline();
    const active = this.reader.querySelector(".ms-chunk.is-current");
    if (active) active.scrollIntoView({ block: "center" });
    this.setStatus(this.playing ? (this.paused ? "已暂停" : "朗读中") : "准备就绪");
    this.updateControls();
  }

  headingFromChunk(chunk, index) {
    const match = String(chunk.source || "").trim().match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!match) return null;
    const text = titleText(match[2]);
    if (!text) return null;
    return { id: `h-${index}`, level: match[1].length, text, index, children: [] };
  }

  buildOutline() {
    this.outline = this.chunks.map((chunk, index) => this.headingFromChunk(chunk, index)).filter(Boolean);
    this.outlineTree = [];
    const stack = [];
    for (const item of this.outline) {
      item.children = [];
      while (stack.length && stack[stack.length - 1].level >= item.level) stack.pop();
      const parent = stack[stack.length - 1];
      if (parent) parent.children.push(item);
      else this.outlineTree.push(item);
      stack.push(item);
    }
    this.renderOutline();
  }

  activeOutlineIndex() {
    let active = -1;
    for (let index = 0; index < this.outline.length; index += 1) {
      if (this.outline[index].index <= this.current) active = index;
      else break;
    }
    return active;
  }

  renderOutline() {
    this.outlineItems.replaceChildren();
    if (!this.outline.length) {
      createEl("div", "ms-outline-empty", this.outlineItems).textContent = "这个文件没有 Markdown 标题层级";
      this.setOutlineOpen(false);
      return;
    }
    const minLevel = Math.min(...this.outline.map((item) => item.level));
    this.renderOutlineNodes(this.outlineTree, minLevel, this.activeOutlineIndex(), this.outlineItems);
    this.setOutlineOpen(this.outlineOpen);
  }

  renderOutlineNodes(nodes, minLevel, active, parent) {
    for (const item of nodes) {
      const flatIndex = this.outline.findIndex((entry) => entry.id === item.id);
      const depth = Math.max(0, item.level - minLevel);
      const hasChildren = item.children.length > 0;
      const collapsed = hasChildren && this.outlineCollapsed.has(item.id);
      const row = createEl("div", `ms-outline-row${collapsed ? " is-collapsed" : ""}`, parent);
      row.style.setProperty("--depth", String(depth));
      if (hasChildren) {
        const disclosure = createEl("button", "ms-outline-disclosure", row);
        disclosure.type = "button";
        disclosure.dataset.id = item.id;
        disclosure.title = collapsed ? "展开小节" : "收起小节";
        disclosure.setAttribute("aria-expanded", collapsed ? "false" : "true");
        disclosure.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      } else {
        createEl("span", "ms-outline-disclosure is-placeholder", row);
      }
      const link = createEl("button", `ms-outline-link${flatIndex === active ? " is-active" : ""}`, row);
      link.type = "button";
      link.dataset.index = String(item.index);
      link.dataset.outlineIndex = String(flatIndex);
      link.textContent = item.text;
      if (flatIndex === active) link.setAttribute("aria-current", "true");
      if (hasChildren && !collapsed) this.renderOutlineNodes(item.children, minLevel, active, parent);
    }
  }

  toggleOutline() {
    if (!this.file) return;
    if (!this.outline.length) {
      this.setStatus("这个文件没有 Markdown 标题层级");
      return;
    }
    this.setOutlineOpen(!this.outlineOpen);
  }

  setOutlineOpen(open) {
    this.outlineOpen = Boolean(open && this.outline.length);
    this.outlinePanel.classList.toggle("is-hidden", !this.outlineOpen);
    this.titleButton.classList.toggle("is-open", this.outlineOpen);
    this.titleButton.setAttribute("aria-expanded", this.outlineOpen ? "true" : "false");
    this.titleButton.title = this.outlineOpen ? "收起大纲" : "展开大纲";
  }

  setAllOutlineNodesExpanded(expanded) {
    this.outlineCollapsed = expanded
      ? new Set()
      : new Set(this.outline.filter((item) => item.children.length).map((item) => item.id));
    this.renderOutline();
  }

  toggleOutlineNode(id) {
    const item = this.outline.find((entry) => entry.id === id);
    if (!item || !item.children.length) return;
    if (this.outlineCollapsed.has(id)) this.outlineCollapsed.delete(id);
    else this.outlineCollapsed.add(id);
    this.renderOutline();
  }

  async goToChunk(index) {
    if (Number.isNaN(index) || index < 0 || index >= this.chunks.length) return;
    const shouldContinue = this.playing && !this.paused;
    if (shouldContinue) await this.stopSpeech(false);
    this.current = index;
    this.playing = shouldContinue;
    this.paused = false;
    await this.saveAutoPosition();
    this.refreshCurrentView(true);
    if (shouldContinue) await this.speakCurrent();
  }

  async moveChunk(delta) {
    if (!this.chunks.length) return;
    const shouldContinue = this.playing && !this.paused;
    this.current = Math.max(0, Math.min(this.chunks.length - 1, this.current + delta));
    await this.stopSpeech(false);
    this.playing = shouldContinue;
    this.paused = false;
    await this.saveAutoPosition();
    if (shouldContinue) this.speakCurrent();
    else this.refreshCurrentView(true);
  }

  async playOrPause() {
    if (this.playing && this.paused) return this.resumeSpeech();
    if (this.playing) return this.pauseSpeech();
    return this.speakCurrent();
  }

  browserRate() {
    return Math.max(0.45, Math.min(2.0, Number(this.rateInput.value) / 190));
  }

  async speakCurrent() {
    if (!this.chunks.length) return;
    this.plugin.stopOtherViews(this);
    this.speechStarting = true;
    await this.stopSpeech(false);
    const generation = ++this.speechGeneration;
    this.playing = true;
    this.paused = false;
    this.refreshCurrentView(true);
    await this.saveAutoPosition();
    const text = this.chunks[this.current].text || speechText(this.chunks[this.current].source);

    if (this.engineSelect.value === "browser" && window.speechSynthesis) {
      this.browserUtterance = new SpeechSynthesisUtterance(text);
      const voice = this.browserVoices.find((item) => item.name === this.voiceSelect.value);
      if (voice && voice.raw) this.browserUtterance.voice = voice.raw;
      this.browserUtterance.lang = voice ? voice.locale : "zh-CN";
      this.browserUtterance.rate = this.browserRate();
      this.browserUtterance.onend = () => this.onChunkEnded(generation);
      this.browserUtterance.onerror = () => this.onChunkEnded(generation);
      window.speechSynthesis.cancel();
      await nextFrame();
      window.speechSynthesis.speak(this.browserUtterance);
      this.speechStarting = false;
      return;
    }

    try {
      const childProcess = require("child_process");
      const proc = childProcess.spawn("say", ["-v", this.voiceSelect.value || "Tingting", "-r", String(Number(this.rateInput.value)), text]);
      this.sayProcess = proc;
      this.sayStartedAt = Date.now();
      proc.on("close", () => {
        if (this.sayProcess !== proc) return;
        this.sayProcess = null;
        if (Date.now() - this.sayStartedAt > 250) this.onChunkEnded(generation);
      });
      this.speechStarting = false;
    } catch (_error) {
      this.playing = false;
      this.paused = false;
      this.speechStarting = false;
      this.setStatus("无法启动 macOS say");
      this.updateControls();
    }
  }

  async onChunkEnded(generation) {
    if (generation !== this.speechGeneration) return;
    if (!this.playing || this.paused) return;
    if (this.current < this.chunks.length - 1) {
      this.current += 1;
      await this.saveAutoPosition();
      this.speakCurrent();
      return;
    }
    this.playing = false;
    this.paused = false;
    await this.saveAutoPosition();
    this.refreshCurrentView(false);
    this.setStatus("完成");
  }

  async pauseSpeech() {
    if (!this.playing || this.paused) return;
    this.terminateActiveSpeech();
    this.paused = true;
    this.refreshCurrentView(false);
  }

  async resumeSpeech() {
    if (!this.playing || !this.paused) return;
    await this.speakCurrent();
  }

  terminateActiveSpeech() {
    this.speechGeneration += 1;
    this.speechStarting = false;
    if (this.browserUtterance) {
      this.browserUtterance.onend = null;
      this.browserUtterance.onerror = null;
    }
    if (window.speechSynthesis) {
      window.speechSynthesis.pause();
      window.speechSynthesis.cancel();
    }
    if (this.sayProcess) {
      const proc = this.sayProcess;
      this.sayProcess = null;
      try {
        proc.kill("SIGKILL");
      } catch (_error) {}
    }
    this.browserUtterance = null;
  }

  async stopSpeech(update = true) {
    this.terminateActiveSpeech();
    if (update) {
      this.playing = false;
      this.paused = false;
      await this.saveAutoPosition();
      this.refreshCurrentView(false);
      this.setStatus("已停止");
    }
  }

  async applySettingsNow() {
    const token = ++this.settingsApplyToken;
    if (!this.chunks.length || !this.playing || this.paused) return;
    await this.stopSpeech(false);
    if (token !== this.settingsApplyToken) return;
    await this.speakCurrent();
    this.setStatus("已应用新设置");
  }

  applySettingsSoon() {
    window.clearTimeout(this.applyTimer);
    this.applyTimer = window.setTimeout(() => this.applySettingsNow(), 250);
  }

  fileKey() {
    return this.file ? this.file.path : "";
  }

  async saveAutoPosition() {
    const key = this.fileKey();
    if (!key) return;
    this.plugin.settings.autoMarks[key] = this.current;
    await this.plugin.saveSettings();
  }

  async saveManualMark() {
    const key = this.fileKey();
    if (!key) return;
    this.plugin.settings.manualMarks[key] = this.current;
    await this.plugin.saveSettings();
    this.setStatus("书签已保存");
  }

  async restoreManualMark() {
    const key = this.fileKey();
    if (!key || this.plugin.settings.manualMarks[key] === undefined) {
      this.setStatus("还没有保存书签");
      return;
    }
    const shouldContinue = this.playing && !this.paused;
    const shouldStayPaused = this.playing && this.paused;
    if (shouldContinue) await this.stopSpeech(false);
    this.current = Math.max(0, Math.min(Number(this.plugin.settings.manualMarks[key]), Math.max(0, this.chunks.length - 1)));
    this.playing = shouldContinue || shouldStayPaused;
    this.paused = shouldStayPaused;
    await this.saveAutoPosition();
    this.refreshCurrentView(true);
    this.setStatus("已回到书签");
    if (shouldContinue) await this.speakCurrent();
  }

  refreshCurrentView(scroll) {
    this.reader.querySelectorAll(".ms-chunk.is-current").forEach((node) => node.classList.remove("is-current"));
    const active = this.reader.querySelector(`.ms-chunk[data-index="${this.current}"]`);
    if (active) {
      active.classList.add("is-current");
      if (scroll) active.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    this.updateOutlineActive();
    this.setStatus(this.playing ? (this.paused ? "已暂停" : "朗读中") : "准备就绪");
    this.updateControls();
  }

  updateOutlineActive() {
    const active = this.activeOutlineIndex();
    this.outlineItems.querySelectorAll(".ms-outline-link.is-active").forEach((node) => {
      node.classList.remove("is-active");
      node.removeAttribute("aria-current");
    });
    const activeLink = this.outlineItems.querySelector(`.ms-outline-link[data-outline-index="${active}"]`);
    if (activeLink) {
      activeLink.classList.add("is-active");
      activeLink.setAttribute("aria-current", "true");
    }
  }

  setStatus(text) {
    this.statusEl.textContent = text;
    this.progressEl.textContent = this.chunks.length ? `${Math.min(this.current + 1, this.chunks.length)} / ${this.chunks.length}` : "0 / 0";
  }

  updateControls() {
    const hasContent = this.chunks.length > 0;
    const activelyPlaying = this.playing && !this.paused;
    this.playButton.title = activelyPlaying ? "暂停" : (this.playing && this.paused ? "继续" : "播放");
    this.playButton.setAttribute("aria-label", this.playButton.title);
    this.playButton.classList.toggle("is-playing", activelyPlaying);
    const iconState = activelyPlaying ? "pause" : "play";
    if (this.playButton.dataset.iconState !== iconState) {
      this.playButton.innerHTML = activelyPlaying ? PAUSE_ICON : PLAY_ICON;
      this.playButton.dataset.iconState = iconState;
    }
    this.stopButton.disabled = !this.playing && !this.paused;
    this.playButton.disabled = !hasContent;
    this.prevButton.disabled = !hasContent || this.current <= 0;
    this.nextButton.disabled = !hasContent || this.current >= this.chunks.length - 1;
  }
}

module.exports = MarkdownSpeakerPlugin;
