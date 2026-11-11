// Private desktop-pet bridge: only a sanitized quota projection goes to stdout.
import {readGoogleQuota} from './google-quota';
const home=process.argv[2]??'',proxy=process.argv[3]||undefined;
readGoogleQuota(home,proxy).then(value=>process.stdout.write(JSON.stringify(value)+'\n')).catch(()=>process.stdout.write(JSON.stringify({status:'unavailable',windows:[],reason:'额度查询失败。',checkedAt:new Date().toISOString()})+'\n'));
