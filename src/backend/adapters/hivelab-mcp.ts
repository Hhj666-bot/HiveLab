import type {AdapterContext} from '../../shared/types';
export function hivelabMcpEnvironment(env:NodeJS.ProcessEnv){
 if(!env.HIVELAB_CONTROL_URL||!env.HIVELAB_CONTROL_TOKEN)throw Error('HiveLab 合屋 工具桥缺少本轮临时授权，未启动成员会话');
 return {ELECTRON_RUN_AS_NODE:'1',HIVELAB_CONTROL_URL:env.HIVELAB_CONTROL_URL,HIVELAB_CONTROL_TOKEN:env.HIVELAB_CONTROL_TOKEN};
}
export function hivelabAcpServers(context:AdapterContext){
 const env=context.env;if(!env.HIVELAB_CONTROL_HELPER||!env.HIVELAB_CONTROL_NODE)return [];
 // MCP stdio hosts may inherit only a safe environment subset. Forward just
 // this session's loopback capability explicitly; never rely on ambient keys.
 return [{name:'hivelab',command:env.HIVELAB_CONTROL_NODE,args:[env.HIVELAB_CONTROL_HELPER,'--mcp'],env:Object.entries(hivelabMcpEnvironment(env)).map(([name,value])=>({name,value}))}];
}
