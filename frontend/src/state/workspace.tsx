/**
 * 工作区上下文：租户 / 应用的全局选择态。
 *
 * 为什么需要它：后端所有业务接口都要求 `X-Tenant-Id`（部分还要求 `X-App-Id`），
 * 控制台的每个页面都必须携带同一套上下文。把它放在 Context 里，页面只关心数据，
 * 不必反复读写 localStorage 或层层透传 ID。
 *
 * 首次进入时的引导逻辑：
 * - 没有任何租户 → 展示「创建租户」引导（空状态，不是报错）；
 * - 有租户但没有应用 → 提示创建应用；
 * - 两项都有 → 直接进入控制台。
 * 这三种状态是「渐进式初始化」，比一上来就抛 404 友好得多。
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { ApiError, appsApi, setWorkspace, tenantsApi } from "../lib/api";
import type { Application, Tenant } from "../lib/types";

const TENANT_KEY = "console.tenantId";
const APP_KEY = "console.appId";

interface WorkspaceValue {
  tenants: Tenant[];
  apps: Application[];
  tenant: Tenant | null;
  app: Application | null;
  loading: boolean;
  error: string | null;
  selectTenant: (id: string) => void;
  selectApp: (id: string) => void;
  createTenant: (name: string, slug: string) => Promise<void>;
  createApp: (name: string, description?: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [apps, setApps] = useState<Application[]>([]);
  const [tenantId, setTenantId] = useState<string | null>(
    () => localStorage.getItem(TENANT_KEY),
  );
  const [appId, setAppId] = useState<string | null>(() => localStorage.getItem(APP_KEY));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 上下文一变就同步给 API 客户端，保证后续请求立刻带上新的 header
  useEffect(() => {
    setWorkspace({ tenantId, appId });
  }, [tenantId, appId]);

  const loadTenants = useCallback(async () => {
    const rows = await tenantsApi.list();
    setTenants(rows);
    return rows;
  }, []);

  // 应用列表由后端按 `X-Tenant-Id` 自动过滤，因此这里不需要显式传租户 ID；
  // 调用前请确保 setWorkspace 已经把 tenantId 同步过去。
  const loadApps = useCallback(async () => {
    const rows = await appsApi.list();
    setApps(rows);
    return rows;
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await loadTenants();
      const current = rows.find((t) => t.id === tenantId) ?? rows[0] ?? null;
      if (current) {
        setTenantId(current.id);
        localStorage.setItem(TENANT_KEY, current.id);
        setWorkspace({ tenantId: current.id });
        const appRows = await loadApps();
        const currentApp = appRows.find((a) => a.id === appId) ?? appRows[0] ?? null;
        setAppId(currentApp?.id ?? null);
        if (currentApp) localStorage.setItem(APP_KEY, currentApp.id);
        else localStorage.removeItem(APP_KEY);
        setWorkspace({ appId: currentApp?.id ?? null });
      } else {
        setApps([]);
        setTenantId(null);
        setAppId(null);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "无法连接后端服务");
    } finally {
      setLoading(false);
    }
  }, [appId, loadApps, loadTenants, tenantId]);

  useEffect(() => {
    void refresh();
    // 仅在首次挂载时初始化；后续切换由 selectTenant/selectApp 驱动
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectTenant = useCallback(
    (id: string) => {
      setTenantId(id);
      localStorage.setItem(TENANT_KEY, id);
      setWorkspace({ tenantId: id });
      setAppId(null);
      localStorage.removeItem(APP_KEY);
      setWorkspace({ appId: null });
      void loadApps().then((rows) => {
        const first = rows[0] ?? null;
        setAppId(first?.id ?? null);
        setWorkspace({ appId: first?.id ?? null });
        if (first) localStorage.setItem(APP_KEY, first.id);
      });
    },
    [loadApps],
  );

  const selectApp = useCallback((id: string) => {
    setAppId(id);
    localStorage.setItem(APP_KEY, id);
    setWorkspace({ appId: id });
  }, []);

  const createTenant = useCallback(
    async (name: string, slug: string) => {
      const created = await tenantsApi.create(name, slug);
      setTenantId(created.id);
      localStorage.setItem(TENANT_KEY, created.id);
      setWorkspace({ tenantId: created.id, appId: null });
      await refresh();
    },
    [refresh],
  );

  const createApp = useCallback(
    async (name: string, description?: string) => {
      const created = await appsApi.create(name, description);
      setApps((prev) => [...prev, created]);
      setAppId(created.id);
      localStorage.setItem(APP_KEY, created.id);
      setWorkspace({ appId: created.id });
    },
    [],
  );

  const value = useMemo<WorkspaceValue>(
    () => ({
      tenants,
      apps,
      tenant: tenants.find((t) => t.id === tenantId) ?? null,
      app: apps.find((a) => a.id === appId) ?? null,
      loading,
      error,
      selectTenant,
      selectApp,
      createTenant,
      createApp,
      refresh,
    }),
    [
      apps,
      appId,
      createApp,
      createTenant,
      error,
      loading,
      refresh,
      selectApp,
      selectTenant,
      tenantId,
      tenants,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace 必须在 WorkspaceProvider 内使用");
  return ctx;
}

/** 需要「应用已就绪」的页面统一用它，避免每页重复判空 */
export function useAppId(): string {
  const { app } = useWorkspace();
  return app?.id ?? "";
}
