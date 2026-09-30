import type { BrowserExtension } from "@raycast/api";
import type { BrowserEntry } from "../types";

export interface BrowserIconAdapter {
  /** 以现有结果 ID 返回可用图标；缺失表示沿用来源图标。 */
  getIcons(
    entries: readonly BrowserEntry[],
    version: number,
  ): Promise<ReadonlyMap<string, string>>;
}

interface BrowserExtensionClient {
  isAvailable(): boolean;
  getTabs(): Promise<BrowserExtension.Tab[]>;
}

export class RaycastBrowserIconAdapter implements BrowserIconAdapter {
  private snapshot?: {
    version: number;
    pending: Promise<Map<string, BrowserExtension.Tab | undefined>>;
  };

  constructor(private client: BrowserExtensionClient) {}

  async getIcons(entries: readonly BrowserEntry[], version: number) {
    const icons = new Map<string, string>();
    const tabs = entries.filter(
      (entry) => entry.source === "tab" && !entry.incognito && entry.tabId,
    );
    if (!tabs.length) return icons;
    // 搜索、来源切换和分页复用同一快照；刷新浏览器数据时重新读取。
    if (this.snapshot?.version !== version) {
      this.snapshot = { version, pending: this.read() };
    }
    const snapshot = await this.snapshot.pending;
    for (const entry of tabs) {
      const tab = snapshot.get(entry.tabId!);
      if (tab?.url === entry.url && tab.favicon?.trim())
        icons.set(entry.id, tab.favicon);
    }
    return icons;
  }

  private async read() {
    const tabs = new Map<string, BrowserExtension.Tab | undefined>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // 必须先检查；直接调用 getTabs 可能弹出浏览器扩展安装提示。
      if (!this.client.isAvailable()) return tabs;
      const timeout = new Promise<BrowserExtension.Tab[]>((resolve) => {
        timer = setTimeout(() => resolve([]), 1500);
      });
      const rows = await Promise.race([this.client.getTabs(), timeout]);
      for (const tab of rows) {
        const id = String(tab.id);
        // SDK 没有 browser/profile 字段；重复 ID 不猜测归属。
        tabs.set(id, tabs.has(id) ? undefined : tab);
      }
    } catch {
      // 可选能力失败时静默回退，不改变 JXA 标签结果与来源状态。
    } finally {
      clearTimeout(timer);
    }
    return tabs;
  }
}
