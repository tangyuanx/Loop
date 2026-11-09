(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.LoopNodeStates=api;})(typeof globalThis==='object'?globalThis:this,()=>{
  const customId=value=>typeof value==='string'&&/^custom_[a-zA-Z0-9_-]{1,80}$/.test(value);
  function normalizeDefinitions(value){
    const ids=new Set(),names=new Set(['未完成','已完成']);
    return (Array.isArray(value)?value:[]).filter(item=>{
      if(!item||!customId(item.id)||ids.has(item.id)||typeof item.name!=='string'||!item.name.trim()||names.has(item.name.trim().toLocaleLowerCase()))return false;
      ids.add(item.id);names.add(item.name.trim().toLocaleLowerCase());return true;
    }).slice(0,24).map(item=>({id:item.id,name:item.name.trim().slice(0,24),color:/^#[0-9a-f]{6}$/i.test(item.color)?item.color:'#81735e'}));
  }
  const normalizeStatus=value=>value==='done'?'done':customId(value)?value:'todo';
  return {normalizeDefinitions,normalizeStatus,customId};
});
