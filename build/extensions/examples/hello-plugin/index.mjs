// HiveLab Plugin API v1: one invocation per process, one JSON request on stdin.
// stdout is reserved for one JSON response. Send diagnostic logs to stderr.
let input='';for await(const chunk of process.stdin)input+=chunk;
try{
 const request=JSON.parse(input);
 if(request.apiVersion!==1||request.tool!=='greet')throw Error('Unsupported tool');
 const name=String(request.arguments?.name??'朋友').slice(0,80);
 process.stdout.write(JSON.stringify({result:{message:`你好，${name}！`,provider:'HiveLab example plugin'}}));
}catch(error){process.stdout.write(JSON.stringify({error:error.message}));process.exitCode=1;}
