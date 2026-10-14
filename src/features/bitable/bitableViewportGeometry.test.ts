import { describe, expect, it } from "vitest";
import { projectViewportGeometry } from "./BitableVirtualBody";
const key = (row: {id: string; value?: string}) => row.id;
const size = () => 36;
describe("视口拓扑只保留key/尺寸，不因格值重建", () => {
  it("相同key/尺寸复用同一索引，内容变动不会留在几何缓存", () => {
    const rows = [{id:"a",value:"旧值"},{id:"b",value:"第二格"}];
    const first = projectViewportGeometry([],rows,key,size,false,true);
    const next = projectViewportGeometry(first,[{id:"a",value:"新值"},rows[1]],key,size,false,true);
    expect(next).toBe(first);
    expect(next).toEqual([{key:"a",size:36,source:0},{key:"b",size:36,source:1},{key:"trailing",size:34,source:2}]);
    expect(JSON.stringify(next)).not.toContain("旧值");
  });
  it("重新排序、相同行数换ID、增删会产生新拓扑",()=>{
    const first=projectViewportGeometry([],[{id:"a"},{id:"b"}],key,size,false,false);
    const reordered=projectViewportGeometry(first,[{id:"b"},{id:"a"}],key,size,false,false);
    expect(reordered).not.toBe(first);expect(reordered.map(e=>e.key)).toEqual(["b","a"]);
    const replaced=projectViewportGeometry(first,[{id:"c"},{id:"b"}],key,size,false,false);
    expect(replaced).not.toBe(first);expect(replaced[0].key).toBe("c");
    expect(projectViewportGeometry(first,[{id:"a"}],key,size,false,false)).toHaveLength(1);
  });
  it("行高/分组尺寸/前后添加条目变化都使尺寸失效",()=>{
    const rows=[{id:"a"},{id:"group"}];
    const first=projectViewportGeometry([],rows,key,size,false,false);
    expect(projectViewportGeometry(first,rows,key,()=>72,false,false)[0].size).toBe(72);
    const leading=projectViewportGeometry(first,rows,key,size,true,false);
    expect(leading[0]).toEqual({key:"leading",size:20,source:-1});
    const trailing=projectViewportGeometry(leading,rows,key,size,true,true);
    expect(trailing.at(-1)).toEqual({key:"trailing",size:34,source:2});
  });
  it("反复5000行格值变化时只保留一份几何元数据",()=>{
    let rows=Array.from({length:5000},(_,i)=>({id:"r"+i,value:"x"}));
    const geometry=projectViewportGeometry([],rows,key,size,false,true);
    for(let i=0;i<25;i++){rows=rows.map((r,index)=>index===i?{...r,value:"y"}:r);expect(projectViewportGeometry(geometry,rows,key,size,false,true)).toBe(geometry);}
    expect(geometry).toHaveLength(5001);
  });
});
