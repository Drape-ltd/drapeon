export type DraftMediaInspection = {
  mimeType: 'image/jpeg'|'image/png'|'image/webp'|'video/mp4'|'video/quicktime'
  width: number
  height: number
  durationMs: number|null
}

const decoder=new TextDecoder('latin1')
const u16=(b:Uint8Array,o:number)=>((b[o]??0)<<8)|(b[o+1]??0)
const u24le=(b:Uint8Array,o:number)=>(b[o]??0)|((b[o+1]??0)<<8)|((b[o+2]??0)<<16)
const u32=(b:Uint8Array,o:number)=>(((b[o]??0)*0x1000000)+((b[o+1]??0)<<16)+((b[o+2]??0)<<8)+(b[o+3]??0))>>>0
const ascii=(b:Uint8Array,o:number,n:number)=>decoder.decode(b.subarray(o,o+n))

function jpegSize(bytes:Uint8Array){
  let offset=2
  while(offset+9<bytes.length){
    if(bytes[offset]!==0xff){offset++;continue}
    const marker=bytes[offset+1]??0
    if(marker===0xd8||marker===0xd9){offset+=2;continue}
    const length=u16(bytes,offset+2)
    if(length<2||offset+2+length>bytes.length)break
    if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker))return {width:u16(bytes,offset+7),height:u16(bytes,offset+5)}
    offset+=2+length
  }
  return null
}

function webpSize(bytes:Uint8Array){
  const kind=ascii(bytes,12,4)
  if(kind==='VP8X')return {width:1+u24le(bytes,24),height:1+u24le(bytes,27)}
  if(kind==='VP8L'&&bytes.length>=25){const b0=bytes[21]??0,b1=bytes[22]??0,b2=bytes[23]??0,b3=bytes[24]??0;return {width:1+(((b2&0x3f)<<8)|b1),height:1+((b3<<6)|(b2>>2))}}
  if(kind==='VP8 '&&bytes.length>=30)return {width:u16(bytes,26)&0x3fff,height:u16(bytes,28)&0x3fff}
  return null
}

function mp4Inspection(bytes:Uint8Array,mimeType:'video/mp4'|'video/quicktime'){
  let durationMs:number|null=null,width=0,height=0
  const walk=(start:number,end:number)=>{
    let offset=start
    while(offset+8<=end){
      const size=u32(bytes,offset),type=ascii(bytes,offset+4,4)
      if(size<8||offset+size>end)break
      if(type==='mvhd'){
        const version=bytes[offset+8]??0
        const base=version===1?offset+28:offset+20
        const timescale=u32(bytes,base),duration=version===1?u32(bytes,base+8):u32(bytes,base+4)
        if(timescale>0&&duration>0)durationMs=Math.round(duration/timescale*1000)
      }
      if(type==='tkhd'&&size>=84){
        width=Math.max(width,u32(bytes,offset+size-8)>>>16)
        height=Math.max(height,u32(bytes,offset+size-4)>>>16)
      }
      if(['moov','trak','mdia'].includes(type))walk(offset+8,offset+size)
      offset+=size
    }
  }
  walk(0,bytes.length)
  if(!width||!height||!durationMs)return null
  return {mimeType,width,height,durationMs}
}

export function inspectDraftMedia(bytes:Uint8Array,declaredType:string):DraftMediaInspection|null{
  const text=decoder.decode(bytes)
  if(/Exif\u0000\u0000|GPSLatitude|GPSLongitude|com\.apple\.quicktime\.location|©xyz|\bloci\b/iu.test(text))return null
  if(bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff&&declaredType==='image/jpeg'){
    const size=jpegSize(bytes);return size?{mimeType:'image/jpeg',...size,durationMs:null}:null
  }
  if(bytes.length>=24&&[137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value)&&declaredType==='image/png')return {mimeType:'image/png',width:u32(bytes,16),height:u32(bytes,20),durationMs:null}
  if(ascii(bytes,0,4)==='RIFF'&&ascii(bytes,8,4)==='WEBP'&&declaredType==='image/webp'){
    if(text.includes('EXIF'))return null
    const size=webpSize(bytes);return size?{mimeType:'image/webp',...size,durationMs:null}:null
  }
  if(ascii(bytes,4,4)==='ftyp'&&(declaredType==='video/mp4'||declaredType==='video/quicktime'))return mp4Inspection(bytes,declaredType)
  return null
}
