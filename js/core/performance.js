const MAX_SAMPLES=120;
const samples=[];

function clock(){return globalThis.performance?.now?.()??Date.now();}

export function recordPerformance(name,duration,details={}){
  const sample={name:String(name),duration:Math.round(Number(duration)*10)/10,at:new Date().toISOString(),...details};
  samples.push(sample);
  if(samples.length>MAX_SAMPLES)samples.splice(0,samples.length-MAX_SAMPLES);
  return sample;
}

export async function measureAsync(name,operation,details={}){
  const started=clock();
  try{return await operation();}
  finally{recordPerformance(name,clock()-started,details);}
}

export function performanceSnapshot(){
  const grouped=new Map();
  samples.forEach(sample=>{
    const current=grouped.get(sample.name)||{name:sample.name,count:0,total:0,max:0};
    current.count+=1;current.total+=sample.duration;current.max=Math.max(current.max,sample.duration);grouped.set(sample.name,current);
  });
  return {
    samples:samples.map(sample=>({...sample})),
    summary:[...grouped.values()].map(item=>({...item,average:Math.round(item.total/item.count*10)/10})),
  };
}
