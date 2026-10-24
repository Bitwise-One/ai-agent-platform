/**
 * 数据加载 hook：把「加载中 / 出错 / 空数据」三种状态统一起来。
 *
 * 控制台每个页面都要做同一件事：拉数据 → 处理异常 → 允许重试。
 * 手写一遍会有三种不同的错误文案与不同的 loading 表现，体验割裂，
 * 因此统一抽成一个 hook，页面只写「怎么取」和「怎么渲染」。
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  /** 本地更新数据（用于删除/编辑后免重新请求） */
  setData: (next: T) => void;
}

export function useAsync<T>(
  loader: () => Promise<T>,
  deps: readonly unknown[] = [],
  options: { enabled?: boolean } = {},
): AsyncState<T> {
  const enabled = options.enabled ?? true;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  // 用 ref 保存最新的 loader，避免把 loader 放进依赖导致每次渲染都重新请求
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  // 竞态保护：切换租户/应用时可能先后发出两个请求，只认最后一个的结果
  const seq = useRef(0);

  const run = useCallback(async () => {
    const current = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const result = await loaderRef.current();
      if (current === seq.current) setData(result);
    } catch (err) {
      if (current === seq.current) {
        setError(err instanceof Error ? err.message : "加载失败");
      }
    } finally {
      if (current === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      setData(null);
      return;
    }
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled]);

  return { data, loading, error, reload: run, setData };
}

/** 表单提交态：统一处理 pending 与错误提示 */
export function useSubmit() {
  const [pending, setPending] = useState(false);
  const run = useCallback(async <R,>(task: () => Promise<R>): Promise<R | undefined> => {
    setPending(true);
    try {
      return await task();
    } finally {
      setPending(false);
    }
  }, []);
  return { pending, run };
}
