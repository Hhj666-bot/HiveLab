import {t} from '../i18n';
import {applySnapshotPatch, acceptSnapshot} from "../../shared/snapshot-sync";
import {unwrapProjectFlowReply} from "../../shared/project-flow";
import {useCallback, useEffect} from "react";
import type {Settings, Snapshot} from "../../shared/types";
import {refreshAfterRpc} from "../../shared/rpc-refresh";
import {errorText, type Invoke} from "../ui";
import {withDefaults} from "./snapshot";
import {useAppActions} from "./store-context";
import type {Notify} from "../ui";
export function useAppBackend(notify:Notify){
  const {setSnapshot,setLoaded,setBackendMessage}=useAppActions();
  const refresh = useCallback(async () => {
    if (!window.hivelab) throw new Error(t("请在 HiveLab 合屋 桌面应用中打开工作台。"));
    const next = withDefaults(await window.hivelab.invoke<Snapshot>('snapshot'));
    setSnapshot(previous=>acceptSnapshot(previous,next));
    setLoaded(true);
    return next;
  }, []);
  const invoke: Invoke = useCallback(async <T,>(method: string, params?: unknown, success?: string, options?:{background?:boolean}): Promise<T> => {
    try {
      if (!window.hivelab) throw new Error(t("桌面后端尚未连接。"));
      const result = unwrapProjectFlowReply(await window.hivelab.invoke<T>(method, params));
      if(method==='settings.save'||method==='settings.language')setSnapshot(previous=>({...previous,settings:result as Settings}));
      else if(refreshAfterRpc(method))await refresh();
      if (success) notify(success);
      return result;
    } catch (error) {
      if(!options?.background)notify(errorText(error), true);
      throw error;
    }
  }, [notify, refresh]);
  const perform = useCallback((method: string, params?: unknown, success?: string) => {
    void invoke(method, params, success).catch(() => {});
  }, [invoke]);
  useEffect(() => {
    if (!window.hivelab) {
      setLoaded(true);
      setBackendMessage(t("桌面后端未连接。请从 HiveLab 合屋 桌面应用打开工作台。"));
      return;
    }
    const unsubscribe = window.hivelab.onEvent(event => {
      if (event.type === 'snapshot') {
        setSnapshot(previous=>acceptSnapshot(previous,withDefaults(event.snapshot)));
        setLoaded(true);
      } else if(event.type==='snapshot-patch'){
        setSnapshot(previous=>{const next=applySnapshotPatch(previous,event);if(!next){queueMicrotask(()=>void refresh().catch(()=>{}));return previous;}return withDefaults(next);});
      } else if (event.type === 'event') {
        setSnapshot(previous => previous.events.some(item => item.id === event.event.id) ? previous : {
          ...previous, events: [...previous.events, event.event],
        });
      } else if(event.type==='backend') {
        setSnapshot(previous => ({ ...previous, backendReady: event.ready }));
        setBackendMessage(event.message ?? '');
      }
    });
    void refresh().catch(error => { setLoaded(true); setBackendMessage(errorText(error)); window.hivelabStartup?.fail(); });
    return unsubscribe;
  }, [refresh]);

  return {refresh,invoke,perform};
}
