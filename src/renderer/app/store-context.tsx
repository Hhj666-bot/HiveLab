import {createContext, useContext, useState, useSyncExternalStore, type ReactNode} from "react";
import {useStore} from "zustand";
import {createAppStore} from "./store";
type Store=ReturnType<typeof createAppStore>;
const AppStoreContext=createContext<Store|null>(null);
export function AppStoreProvider({children}:{children:ReactNode}){
  const [store]=useState(createAppStore);
  return <AppStoreContext.Provider value={store}>{children}</AppStoreContext.Provider>;
}
export function useAppStore<T,>(selector:(state:ReturnType<Store['getState']>)=>T):T{
  const store=useContext(AppStoreContext);
  if(!store)throw new Error('AppStoreProvider is missing');
  return useStore(store,selector);
}
export const useAppActions=()=>useAppStore(state=>state.actions);
const noSubscription=()=>()=>{};
/** Reads the app store when one exists; isolated fixtures without a provider get undefined. */
export function useOptionalAppStore<T,>(selector:(state:ReturnType<Store['getState']>)=>T):T|undefined{
  const store=useContext(AppStoreContext);
  return useSyncExternalStore(store?store.subscribe:noSubscription,()=>store?selector(store.getState()):undefined);
}
