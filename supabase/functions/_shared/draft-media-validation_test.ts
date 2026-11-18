import { assertEquals } from 'jsr:@std/assert@1'
import { inspectDraftMedia } from './draft-media-validation.ts'

Deno.test('accepts a metadata-free PNG and reads dimensions',()=>{
  const bytes=new Uint8Array(24)
  bytes.set([137,80,78,71,13,10,26,10],0)
  bytes.set([0,0,2,0,0,0,1,0],16)
  assertEquals(inspectDraftMedia(bytes,'image/png'),{mimeType:'image/png',width:512,height:256,durationMs:null})
})

Deno.test('rejects declared MIME mismatches and embedded location metadata',()=>{
  const mismatch=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,1])
  assertEquals(inspectDraftMedia(mismatch,'image/jpeg'),null)
  const located=new TextEncoder().encode('RIFF0000WEBPVP8X000000000000GPSLatitude')
  assertEquals(inspectDraftMedia(located,'image/webp'),null)
})
