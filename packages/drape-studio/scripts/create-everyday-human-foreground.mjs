#!/usr/bin/env node
/**
 * Make clean arm and head/neck foreground cutouts for the fixed Everyday
 * model variants. The renderer masks the arm layer by the active top's alpha
 * so sleeves cover the original arms while skin stays in front beside them.
 */
import {createRequire} from 'node:module'
import {mkdir} from 'node:fs/promises'
import {dirname,resolve} from 'node:path'

const require=createRequire(new URL('../../../apps/web/package.json',import.meta.url))
const sharp=require('sharp')
const root=resolve(new URL('../assets/wardrobe/easy-everyday/',import.meta.url).pathname)
const variants=['shorts','leggings']
const hairDetailMaxRow=190
const headDetailRows=125
const handsMaxRow=460

for(const variant of variants){
  const source=resolve(root,`v2/base-${variant}.png`)
  const output=resolve(root,`v9/front-human-${variant}.png`)
  const headOutput=resolve(root,`v9/front-head-${variant}.png`)
  const {data,info}=await sharp(source).ensureAlpha().raw().toBuffer({resolveWithObject:true})
  const arms=new Uint8Array(info.width*info.height)
  const head=new Uint8Array(info.width*info.height)
  let armPixels=0,headPixels=0
  const center=info.width/2
  for(let y=0;y<Math.min(info.height,handsMaxRow);y++){
    for(let x=0;x<info.width;x++){
      const i=(y*info.width+x)*4,r=data[i],g=data[i+1],b=data[i+2],a=data[i+3]
      if(a<80)continue
      const skin=r>g+13&&g>b+3&&r>82&&g>45
      const hair=Math.max(r,g,b)<92&&r>=g-3&&g>=b-3
      const centered=Math.abs(x-center)
      const face=skin&&y<headDetailRows&&centered<info.width*.16
      const headDetail=face||hair&&y<hairDetailMaxRow
      // Skin-colour noise also occurs on the torso and neutral base. Keep
      // only the side corridors where the source model's arms actually sit.
      const armCorridorHalf=y<185?.16:y<285?.19:y<380?.14:.10
      const armDetail=skin&&y>=145&&Math.abs(x-center)>info.width*armCorridorHalf
      const index=y*info.width+x
      if(headDetail){head[index]=1;headPixels++}
      if(armDetail){arms[index]=1;armPixels++}
    }
  }
  // Fill one-pixel holes inside these source pixels without expanding either
  // silhouette. Their alpha edges already carry the original antialiasing.
  const fillSmallHoles=(selected)=>{
   const filled=Uint8Array.from(selected)
   for(let y=1;y<Math.min(info.height-1,handsMaxRow);y++)for(let x=1;x<info.width-1;x++){
    const at=y*info.width+x,i=at*4
    if(selected[at]||data[i+3]<80)continue
    let neighbours=0
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(dx||dy)neighbours+=selected[(y+dy)*info.width+x+dx]||0
    if(neighbours>=7)filled[at]=1
   }
   return filled
  }
  const keepLargeComponents=(selected,minPixels=40)=>{
   const visited=new Uint8Array(selected.length),cleaned=new Uint8Array(selected.length),queue=new Uint32Array(selected.length)
   for(let start=0;start<selected.length;start++){
    if(!selected[start]||visited[start])continue
    let read=0,write=0;queue[write++]=start;visited[start]=1
    while(read<write){
     const at=queue[read++],x=at%info.width,y=Math.floor(at/info.width)
     for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      if(!dx&&!dy)continue
      const nx=x+dx,ny=y+dy
      if(nx<0||nx>=info.width||ny<0||ny>=info.height)continue
      const next=ny*info.width+nx
      if(selected[next]&&!visited[next]){visited[next]=1;queue[write++]=next}
     }
    }
    if(write>=minPixels)for(let i=0;i<write;i++)cleaned[queue[i]]=1
   }
   return cleaned
  }
  const armMask=fillSmallHoles(keepLargeComponents(arms)),headMask=fillSmallHoles(keepLargeComponents(head))
  const makeImage=mask=>{const out=Buffer.from(data);for(let i=0;i<mask.length;i++)if(!mask[i])out[i*4+3]=0;return out}
  await mkdir(dirname(output),{recursive:true})
  await sharp(makeImage(armMask),{raw:{width:info.width,height:info.height,channels:4}}).png().toFile(output)
  await sharp(makeImage(headMask),{raw:{width:info.width,height:info.height,channels:4}}).png().toFile(headOutput)
  console.log(JSON.stringify({variant,source,arms:output,head:headOutput,dimensions:{width:info.width,height:info.height},armPixels,headPixels}))
}
