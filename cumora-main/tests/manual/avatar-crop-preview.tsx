import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AvatarCropper } from '../../src/components/AvatarCropper'
import '../../src/styles/globals.css'
import fixture from './avatar-crop-test.png'
function Preview() {
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState('')
  return <main style={{padding:40}}>
    <h1>头像裁切验证（测试图片）</h1>
    <p>此页面不会修改任何智能体头像。</p>
    <button onClick={async () => setFile(new File([await (await fetch(fixture)).blob()], 'test.png', {type:'image/png'}))}>选择测试图片</button>
    {result && <><p>裁切后的图片</p><img src={result} alt="裁切结果" style={{width:200,height:200,borderRadius:'50%'}} /></>}
    {file && <AvatarCropper file={file} onCancel={() => setFile(null)} onConfirm={value => {if(result)URL.revokeObjectURL(result);setResult(URL.createObjectURL(value));setFile(null)}} />}
  </main>
}
createRoot(document.getElementById('root')!).render(<Preview />)
