import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { decodeNcm, isNcmFile, NcmError } from '../ncm.js';

// CryptoJS is a normal browser script in production; isolate its UMD wrapper here.
const context = vm.createContext({ Uint8Array, ArrayBuffer });
vm.runInContext(await readFile(new URL('../vendor/crypto-js.min.js', import.meta.url), 'utf8'), context);
globalThis.CryptoJS = context.CryptoJS;
const CORE = Buffer.from('687a4852416d736f356b496e62617857', 'hex');
const META = Buffer.from('2331346c6a6b5f215c5d2630553c2728', 'hex');
const fixtureKey = Buffer.from('synthetic-ncm-key-for-format-tests');
const mp3 = Buffer.from([73,68,51,4,0,0,0,0,0,0,255,251,144,100,0,12,34,56,78,90]);
const flac = Buffer.from([102,76,97,67,128,0,0,34,...Array.from({ length: 34 }, (_,i) => i)]);
const png = Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]);
const u32 = value => { const output=Buffer.alloc(4); output.writeUInt32LE(value); return output; };
const aes = (input,key) => { const cipher=createCipheriv('aes-128-ecb',key,null); return Buffer.concat([cipher.update(input),cipher.final()]); };
const xor = (input,value) => Buffer.from(input.map(byte=>byte^value));

function scramble(audio, key = fixtureKey) {
  // Fixture encoder uses a plain numeric key box, independent of the decoder's
  // precomputed 256-byte stream implementation.
  const box=Array.from({length:256},(_,i)=>i);
  let last=0,offset=0;
  for(let i=0;i<256;i++){
    const value=box[i], target=(value+last+key[offset++])&255;
    if(offset===key.length)offset=0;
    box[i]=box[target];box[target]=value;last=target;
  }
  const output=Buffer.alloc(audio.length);
  for(let i=0;i<audio.length;i++){
    const j=(i+1)&255;
    output[i]=audio[i]^box[(box[j]+box[(box[j]+j)&255])&255];
  }
  return output;
}

function fixture({audio=mp3,metadata={musicName:'测试歌曲',artist:[['音乐家',42]],album:'本地专辑',format:'mp3'},image=Buffer.alloc(0),coverPadding=0,encryptedMetadata}={}){
  const key=xor(aes(Buffer.concat([Buffer.from('neteasecloudmusic'),fixtureKey]),CORE),0x64);
  const meta=encryptedMetadata??(metadata===null?Buffer.alloc(0):xor(Buffer.from("163 key(Don't modify):"+aes(Buffer.from('music:'+JSON.stringify(metadata)),META).toString('base64')),0x63));
  return Buffer.concat([Buffer.from('CTENFDAM'),Buffer.alloc(2),u32(key.length),key,u32(meta.length),meta,Buffer.alloc(5),u32(image.length+coverPadding),u32(image.length),image,Buffer.alloc(coverPadding,0x91),scramble(audio)]);
}
const file = (bytes,name='fixture.ncm') => new File([bytes],name,{type:'application/octet-stream',lastModified:123});

test('NCM selection only recognises local filename suffixes',()=>{
  assert.equal(isNcmFile({name:'歌名.NCM'}),true);
  assert.equal(isNcmFile({name:'song.mp3'}),false);
  assert.equal(isNcmFile(null),false);
});

test('local NCM MP3 recovers exact bytes and Unicode metadata with safe output name',async()=>{
  const progress=[];
  const result=await decodeNcm(file(fixture({metadata:{musicName:'夜空 / 星🌙',artist:[['歌手甲',1],['歌手乙',2]],album:'月光',albumPic:'https://example.com/not-requested.jpg',format:'flac'}})),{onProgress:value=>progress.push(value)});
  assert.deepEqual(Buffer.from(await result.file.arrayBuffer()),mp3);
  assert.equal(result.file.type,'audio/mpeg');
  assert.equal(result.file.name,'歌手甲 _ 歌手乙 - 夜空 _ 星🌙.mp3');
  assert.deepEqual(result.metadata,{title:'夜空 / 星🌙',artist:'歌手甲 / 歌手乙',album:'月光'});
  assert.equal(result.artworkBlob,null);
  assert.equal(progress[0],0);assert.equal(progress.at(-1),1);
  assert.ok(progress.every((value,index)=>index===0||value>=progress[index-1]));
});

test('FLAC is detected by magic and the complete modern cover frame is skipped',async()=>{
  const result=await decodeNcm(file(fixture({audio:flac,image:png,coverPadding:128,metadata:{musicName:'无损歌曲',artist:[['甲',1]],format:'mp3'}})));
  assert.deepEqual(Buffer.from(await result.file.arrayBuffer()),flac);
  assert.equal(result.file.type,'audio/flac');
  assert.match(result.file.name,/\.flac$/);
  assert.equal(result.artworkBlob.type,'image/png');
  assert.deepEqual(Buffer.from(await result.artworkBlob.arrayBuffer()),png);
});

test('optional metadata can be absent and raw MPEG frames remain playable data',async()=>{
  const frames=Buffer.from([255,251,144,100,0,1,2,3,4,5]);
  const result=await decodeNcm(file(fixture({audio:frames,metadata:null}),'歌手 - 原始音轨.NCM'));
  assert.deepEqual(Buffer.from(await result.file.arrayBuffer()),frames);
  assert.deepEqual(result.metadata,{title:'原始音轨',artist:'歌手',album:'未知专辑'});
  assert.equal(result.file.name,'歌手 - 原始音轨.mp3');
});

test('bad optional tags fall back and embedded SVG is never treated as artwork',async()=>{
  const result=await decodeNcm(file(fixture({encryptedMetadata:Buffer.from([1,2,3,4]),image:Buffer.from('<svg onload="alert(1)"></svg>')}),'回退.ncm'));
  assert.equal(result.metadata.title,'回退');
  assert.equal(result.artworkBlob,null);
  assert.deepEqual(Buffer.from(await result.file.arrayBuffer()),mp3);
});

test('invalid magic, truncated fields, impossible cover lengths and non-audio payload reject',async()=>{
  const valid=fixture();
  const badMagic=Buffer.from(valid);badMagic[0]=0;
  const badKeyLength=Buffer.from(valid);badKeyLength.writeUInt32LE(0xffffffff,10);
  const shortHeader=valid.subarray(0,20);
  const wrongCover=fixture({metadata:null});
  const keyLength=wrongCover.readUInt32LE(10);
  const coverLengthOffset=14+keyLength+4+5;
  wrongCover.writeUInt32LE(0,coverLengthOffset);
  wrongCover.writeUInt32LE(8,coverLengthOffset+4);
  for(const invalid of [badMagic,badKeyLength,shortHeader,wrongCover,fixture({audio:Buffer.from('not music data')})]){
    await assert.rejects(decodeNcm(file(invalid)),NcmError);
  }
  await assert.rejects(decodeNcm('https://example.com/file.ncm'),NcmError);
});

test('damaged AES key blocks cannot produce a false success',async()=>{
  const broken=fixture();broken[15]^=1;
  await assert.rejects(decodeNcm(file(broken)),NcmError);
});

test('large payloads decode across yielded chunks and allow explicit import cancellation',async()=>{
  const payload=Buffer.alloc(2*1024*1024+513,0x5a);mp3.copy(payload);
  const original=file(fixture({audio:payload}));
  const updates=[];
  const decoded=await decodeNcm(original,{onProgress:value=>updates.push(value)});
  assert.deepEqual(Buffer.from(await decoded.file.arrayBuffer()),payload);
  assert.ok(updates.length>=5);
  const cancellation=new Error('cancel-import');
  await assert.rejects(decodeNcm(original,{onProgress:value=>{if(value>.1)throw cancellation;}}),error=>error===cancellation);
});

test('size guard and missing decoder fail with actionable codes',async()=>{
  const oversized=file(fixture());Object.defineProperty(oversized,'size',{value:201*1024*1024});
  await assert.rejects(decodeNcm(oversized),error=>error.code==='file_too_large');
  const crypto=globalThis.CryptoJS;delete globalThis.CryptoJS;
  try{await assert.rejects(decodeNcm(file(fixture())),error=>error.code==='decoder_unavailable');}
  finally{globalThis.CryptoJS=crypto;}
});
