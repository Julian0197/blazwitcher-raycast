import {
  Action,
  ActionPanel,
  Clipboard,
  Color,
  Icon,
  List,
  Keyboard,
  Toast,
  closeMainWindow,
  getPreferenceValues,
  openExtensionPreferences,
  showToast,
} from "@raycast/api";
import { useMemo, useState } from "react";
import { describeError, navigateTo } from "../browser/chrome";
import { parseHistoryLimit } from "../browser/history";
import { useBrowserSearch } from "../hooks/use-browser-search";
import { parseQuery, switchScope } from "../search/query";
import { createResultSections } from "../search/result-sections";
import { sourceShortcut } from "../search/source-shortcuts";
import {
  sourceNames,
  type ChromeTabGroupColor,
  type Scope,
  type SearchResult,
  type Source,
} from "../types";

const icons: Record<Source, Icon> = {
  tab: Icon.AppWindow,
  bookmark: Icon.Bookmark,
  history: Icon.Clock,
};
const scopeNames: Record<Scope, string> = { all: "全部来源", ...sourceNames };
const tabGroupColors: Record<ChromeTabGroupColor, string> = {
  grey: "#9AA0A6",
  blue: "#1A73E8",
  red: "#D93025",
  yellow: "#F9AB00",
  green: "#188038",
  pink: "#E52592",
  purple: "#A142F4",
  cyan: "#01A9B4",
  orange: "#FA903E",
};

export default function SearchBrowser({
  scope: fixedScope = "all",
}: {
  scope?: Scope;
}) {
  const preferences = getPreferenceValues<{
    historyLimit?: string;
    includeIncognito?: boolean;
    sourceShortcuts?: string;
    startupPreview?: boolean;
  }>();
  const options = useMemo(
    () => ({
      scope: fixedScope,
      historyLimit: parseHistoryLimit(preferences.historyLimit),
      includeIncognito: preferences.includeIncognito ?? false,
      startupPreview: preferences.startupPreview ?? true,
    }),
    [
      fixedScope,
      preferences.historyLimit,
      preferences.includeIncognito,
      preferences.startupPreview,
    ],
  );
  const [input, setInput] = useState("");
  const [selectedScope, setSelectedScope] = useState<Scope>(fixedScope);
  const [selectedId, setSelectedId] = useState<string | null>();
  const query = parseQuery(input, selectedScope, fixedScope);
  const state = useBrowserSearch(options, query.text, query.scope);
  const { page, snapshot } = state;
  const cached = Object.entries(snapshot?.states ?? {}).some(
    ([source, state]) =>
      state.cached && (query.scope === "all" || query.scope === source),
  );
  const busy =
    state.searching ||
    Object.values(snapshot?.states ?? {}).some((source) => source.loading);
  const warnings = Object.entries(snapshot?.states ?? {}).flatMap(
    ([source, status]) =>
      status.warnings.map(
        (warning) => `${sourceNames[source as Source]}：${warning}`,
      ),
  );
  if (state.error) warnings.push(state.error);
  const refresh = () => state.service.refresh();
  const selectScope = (scope: Scope) => {
    const next = switchScope(input, scope, fixedScope);
    const nextQuery = parseQuery(next.input, next.scope, fixedScope);
    if (nextQuery.text !== query.text || nextQuery.scope !== query.scope) {
      state.cancel();
      setSelectedId(undefined);
    }
    setInput(next.input);
    setSelectedScope(next.scope);
  };

  const actions = (result?: SearchResult) => {
    const resolve = () => {
      if (!page || !result) throw new Error("结果已更新，请重新选择。");
      return state.service.entry({
        id: result.entry.id,
        requestId: page.requestId,
        version: page.version,
      });
    };
    const open = async () => {
      try {
        await navigateTo(resolve());
        await closeMainWindow();
      } catch (error) {
        await showToast({
          style: Toast.Style.Failure,
          title: "打开失败",
          message:
            error instanceof Error && error.message.includes("结果已更新")
              ? error.message
              : describeError(error),
        });
      }
    };
    const copy = async () => {
      try {
        await Clipboard.copy(resolve().url);
        await showToast({ style: Toast.Style.Success, title: "已复制地址" });
      } catch {
        await showToast({
          style: Toast.Style.Failure,
          title: "结果已更新，请重新选择",
        });
      }
    };
    return (
      <ActionPanel>
        {result && (
          <ActionPanel.Section>
            <Action
              title={
                result.entry.source === "tab"
                  ? "切换到标签页"
                  : "在 Chrome 中打开"
              }
              icon={Icon.ArrowRight}
              onAction={open}
            />
            <Action
              title="复制地址"
              icon={Icon.Clipboard}
              shortcut={{ modifiers: ["cmd"], key: "c" }}
              onAction={copy}
            />
          </ActionPanel.Section>
        )}
        {fixedScope === "all" && (
          <ActionPanel.Section title="切换搜索来源">
            {(Object.keys(scopeNames) as Scope[]).map((scope) => (
              <Action
                key={scope}
                title={`搜索${scopeNames[scope]}`}
                icon={
                  scope === query.scope ? Icon.Checkmark : Icon.MagnifyingGlass
                }
                shortcut={sourceShortcut(scope, preferences.sourceShortcuts)}
                onAction={() => selectScope(scope)}
              />
            ))}
          </ActionPanel.Section>
        )}
        <ActionPanel.Section>
          <Action
            title="刷新浏览器数据"
            icon={Icon.ArrowClockwise}
            shortcut={Keyboard.Shortcut.Common.Refresh}
            onAction={refresh}
          />
          {fixedScope !== "tab" && (
            <ActionPanel.Submenu title="切换 Chrome 配置" icon={Icon.Person}>
              <Action
                title="全部配置"
                onAction={() => state.selectProfile("all")}
              />
              {snapshot?.profiles.map((profile) => (
                <Action
                  key={profile.id}
                  title={profile.name}
                  icon={
                    profile.id === snapshot.profileId
                      ? Icon.Checkmark
                      : Icon.Person
                  }
                  onAction={() => state.selectProfile(profile.id)}
                />
              ))}
            </ActionPanel.Submenu>
          )}
          <Action
            title="清除启动缓存"
            icon={Icon.Trash}
            onAction={async () => {
              const cleared = state.service.clearPreviewCache();
              await showToast({
                style: cleared ? Toast.Style.Success : Toast.Style.Failure,
                title: cleared ? "已清除启动缓存" : "清除启动缓存失败，请重试",
              });
            }}
          />
          <Action
            title="扩展设置"
            icon={Icon.Gear}
            onAction={openExtensionPreferences}
          />
        </ActionPanel.Section>
      </ActionPanel>
    );
  };
  const activeId = page?.results.some(
    (result) => result.entry.id === selectedId,
  )
    ? (selectedId ?? undefined)
    : page?.results[0]?.entry.id;
  const sections = page
    ? createResultSections(page.results, query.text, fixedScope)
    : [];
  const resultSummary = page
    ? `${page.total.toLocaleString()} 个结果${cached ? " · 缓存预览" : ""}`
    : "正在搜索…";
  const renderResult = (result: SearchResult) => {
    const entry = result.entry;
    const accessories: List.Item.Accessory[] = [];
    if (entry.source === "tab" && entry.tabGroup)
      accessories.push({
        tag: {
          value: entry.tabGroup.title || "标签组",
          color: tabGroupColors[entry.tabGroup.color],
        },
        tooltip: "Chrome 标签组",
      });
    if (entry.source === "tab" && entry.active)
      accessories.push({
        tag: { value: "当前标签", color: Color.Green },
      });
    if (entry.incognito)
      accessories.push({ icon: Icon.EyeDisabled, tooltip: "无痕标签" });
    if (entry.source === "history" && entry.visitedAt !== undefined) {
      const visited = new Date(entry.visitedAt);
      if (!Number.isNaN(visited.getTime()))
        accessories.push({
          date: visited,
          tooltip: `最近访问：${visited.toLocaleString("zh-CN", { hour12: false })}`,
        });
    }
    accessories.push({
      text: sourceNames[entry.source],
      tooltip: entry.profile?.name ?? "Chrome",
    });
    return (
      <List.Item
        key={entry.id}
        id={entry.id}
        icon={icons[entry.source]}
        title={{ value: entry.title, tooltip: entry.title }}
        subtitle={{ value: entry.url, tooltip: entry.url }}
        accessories={accessories}
        actions={actions(result)}
      />
    );
  };
  return (
    <List
      isShowingDetail={false}
      filtering={false}
      isLoading={busy}
      searchText={input}
      onSearchTextChange={(text) => {
        if (text === input) return;
        const next = parseQuery(text, selectedScope, fixedScope);
        if (next.text !== query.text || next.scope !== query.scope)
          state.cancel();
        setSelectedId(undefined);
        setInput(text);
      }}
      selectedItemId={activeId}
      onSelectionChange={setSelectedId}
      searchBarPlaceholder={`搜索${fixedScope === "all" ? "标签页、书签和历史记录" : sourceNames[fixedScope]}，支持拼音与首字母…`}
      navigationTitle="Blazwitcher · 搜索浏览器"
      searchBarAccessory={
        fixedScope === "all" ? (
          <List.Dropdown
            tooltip="搜索来源"
            value={query.scope}
            onChange={(value) => selectScope(value as Scope)}
          >
            {Object.entries(scopeNames).map(([value, title]) => (
              <List.Dropdown.Item key={value} value={value} title={title} />
            ))}
          </List.Dropdown>
        ) : undefined
      }
      pagination={{
        pageSize: 50,
        hasMore: Boolean(page && page.results.length < page.total),
        onLoadMore: state.loadMore,
      }}
    >
      {sections.map((section, index) => (
        <List.Section
          key={section.key}
          title={section.key === "results" ? resultSummary : section.title}
          subtitle={
            section.key === "results"
              ? cached
                ? "缓存预览 · 正在读取完整数据"
                : fixedScope === "tab"
                  ? "Chrome 标签页"
                  : `历史上限 ${options.historyLimit.toLocaleString()}`
              : index === 0
                ? `${resultSummary}${cached ? " · 正在读取完整数据" : ""}`
                : undefined
          }
        >
          {section.results.map(renderResult)}
        </List.Section>
      ))}
      {warnings.length > 0 && (
        <List.Section title="来源状态">
          {warnings.map((warning) => (
            <List.Item
              key={warning}
              title={warning}
              icon={{ source: Icon.Warning, tintColor: Color.Orange }}
              actions={actions()}
            />
          ))}
        </List.Section>
      )}
      <List.EmptyView
        title={busy ? "正在读取浏览器数据…" : "没有找到匹配结果"}
        description="试试中文、完整拼音、首字母或网址。"
        icon={Icon.MagnifyingGlass}
        actions={actions()}
      />
    </List>
  );
}
